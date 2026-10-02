import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { Provider, IdentificationResult } from '@/lib/identification'
import { isIdentificationResult } from '@/lib/identification'
import { CV_FIRST_IDENTIFICATION_JSON_SCHEMA, buildCvFirstIdentificationPrompt } from '@/lib/cv-first-identification'
import { runMeasurementPreflight, MeasurementServiceError } from '@/lib/measurement-client'
import { verifyMeasurementProof } from '@/lib/measurement-proof'
import { selectLengthFromCv } from '@/lib/cv-length-policy'
import { preflightPurchaseGate, finalPurchaseGate, publicPurchaseGuidance } from '@/lib/cv-purchase-policy'
import { evaluateHeadStyleConsistency } from '@/lib/head-style-consistency'
import { sanitizeDriveEvidence, stripUnverifiedDriveSizeClaims } from '@/lib/drive-evidence'
import {
  assessPurchaseSpecificationCompleteness,
  publicCompletenessGuidance,
} from '@/lib/purchase-spec-completeness'
import type { MeasurementResult, FixedDimension } from '@/lib/measurement'
import { loadReferencePack } from '@/lib/reference-loader'
import { buildCvDimensionCandidate, buildCvGroundingBasis } from '@/lib/cv-grounding-basis'
import { toMeasurementV2 } from '@/lib/measurement-v2'
import { STANDARDS_CATALOGUE_V1 } from '@/lib/standards-database-v1'
import { buildStandardsAuthorityResult, buildStandardsShadowResult } from '@/lib/standards-shadow-solver'
import { buildPublicFormalSurfaces, projectSelectedFormalNominal } from '@/lib/formal-nominal-projection'
import { localizeForMeasurement, type SemanticLocalizationResult } from '@/lib/semantic-localizer'
import { buildCandidateBlindSemanticRequest, type CandidateBlindSemanticRequest } from '@/lib/candidate-blind-semantic-request'
import { extractCandidateBlindSemanticEvidence } from '@/lib/semantic-extractor'
import type { RawSemanticSensorObservation, SemanticEvidenceV1 } from '@/lib/semantic-evidence-v1'
import { CANDIDATE_FEATURE_METADATA_V1 } from '@/lib/candidate-feature-metadata-v1'
import { compileCandidateFeatureMatrix } from '@/lib/candidate-feature-compiler'
import { buildSemanticDiscriminationPlan } from '@/lib/semantic-discrimination-plan-v1'
import { buildTargetedSemanticRequest, assertTargetedRequestCandidateBlind } from '@/lib/targeted-semantic-request'
import {
  buildTargetedSemanticEvidence,
  buildTargetedSemanticPrompt,
  targetedSemanticSensorJsonSchema,
  type TargetedSemanticEvidence,
} from '@/lib/targeted-semantic-extractor'
import { buildCandidateSemanticDiscrimination } from '@/lib/candidate-semantic-discrimination'
import { PRODUCTION_SEMANTIC_CALIBRATION_REGISTRY } from '@/lib/semantic-calibration-v1'
import { buildSemanticCalibrationAssessment } from '@/lib/semantic-calibration-assessment'
import { buildSemanticLikelihoodEvidence } from '@/lib/semantic-likelihood-evidence-v1'

const MAX_IMAGE_LENGTH = 7_000_000
const PROVIDER_CONFIG = {
  gemini: { envKey: 'GEMINI_API_KEY', model: 'gemini-3.7-flash', label: 'Gemini' },
  openai: { envKey: 'OPENAI_API_KEY', model: 'gpt-5.6-sol', label: 'OpenAI' },
  grok: { envKey: 'XAI_API_KEY', model: 'grok-4.6', label: 'Grok' },
} as const
type JsonSchema = Record<string, unknown>
type MeasurementServiceFallback = { code: string; message: string } | null

// B is optional LLM evidence only when CV can support it; never a hard gate.
// Keep six fixed core slots for transparent per-dimension failure diagnostics.
const REQUIRED_INFERENCE_DIMENSIONS: FixedDimension[] = ['D','P','L_underhead','L_overall','K','DK']

export async function handleIdentificationRequest(request: Request, provider: Provider) {
  try {
    const body = await request.json()
    const image = typeof body.image === 'string' ? body.image : ''
    if (!image || image.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(image)) {
      return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
    }
    const config = PROVIDER_CONFIG[provider]
    const apiKey = process.env[config.envKey]
    if (!apiKey) return NextResponse.json({ error: `${config.label} 分析服務尚未完成設定。` }, { status: 503 })

    let measurement: MeasurementResult | null = null
    let measurementServiceError: MeasurementServiceFallback = null
    let semanticLocalization: SemanticLocalizationResult | null = null
    const proofValid = verifyMeasurementProof(body.measurement, body.measurement_proof, image)
    const proofHasSemanticRoi = proofValid &&
      body.measurement?.object?.semantic_routing_supplied === true
    if (proofHasSemanticRoi) {
      measurement = body.measurement as MeasurementResult
    } else {
      try {
        // Semantic localization is a spatial prior only: target/reference ROI
        // and coarse head style. It supplies no physical dimensions.
        semanticLocalization = await localizeForMeasurement(image, provider)
        measurement = await runMeasurementPreflight(
          image,
          [],
          semanticLocalization.semantic_vision,
        )
      } catch (error) {
        if (error instanceof MeasurementServiceError) {
          measurementServiceError = { code: error.code, message: error.message }
        } else {
          measurementServiceError = {
            code: 'measurement_localization_or_cv_error',
            message: error instanceof Error ? error.message : '量測定位或 CV 無法使用。',
          }
        }
      }
    }
    const cvComplete = !!measurement?.dimensions && REQUIRED_INFERENCE_DIMENSIONS.every(key => !!measurement?.dimensions?.[key])
    if (measurement && !cvComplete) throw new Error('CV-first 回傳缺少推論所需的固定尺寸槽位')

    // Phase 2B shadow-only semantic first pass. The request builder is a runtime
    // allowlist: no measurement mm, standards candidates, legacy nominal or GT
    // can cross into this extractor.
    let semanticEvidence: SemanticEvidenceV1 | null = null
    let semanticEvidenceError: string | null = null
    let semanticRequest: CandidateBlindSemanticRequest | null = null
    try {
      semanticRequest = buildCandidateBlindSemanticRequest({
        image,
        target_region: semanticLocalization?.semantic_vision.target_region ?? null,
      })
      semanticEvidence = await extractCandidateBlindSemanticEvidence(semanticRequest, provider)
    } catch (error) {
      semanticEvidenceError = error instanceof Error ? error.message : 'semantic_evidence_unavailable'
      console.warn('[HCSI] candidate-blind semantic evidence unavailable:', semanticEvidenceError)
    }

    const preflightGate = preflightPurchaseGate(measurement)
    const cvGroundingBasis = buildCvGroundingBasis(measurement, preflightGate.allowed)
    const dimensionCandidate = buildCvDimensionCandidate(cvGroundingBasis)
    const reference = await loadReferencePack('fasteners')
    const providerPayload = await runStructuredProvider({
      provider, apiKey, model: config.model, image,
      prompt: buildCvFirstIdentificationPrompt(measurement, measurementServiceError?.code ?? null,
        reference.core, reference.category, preflightGate.allowed),
      schemaName: 'hcsi_cv_first_identification',
      schema: CV_FIRST_IDENTIFICATION_JSON_SCHEMA as unknown as JsonSchema,
      maxOutputTokens: 4600,
    })
    if (!isIdentificationResult(providerPayload) ||
        !providerPayload.fastener_interpretation ||
        typeof providerPayload.fastener_interpretation.head_style !== 'string') {
      throw new Error(`${config.label} CV-first 語義辨識結果格式不完整`)
    }
    const identificationRaw = providerPayload as IdentificationResult & {
      fastener_interpretation: NonNullable<IdentificationResult['fastener_interpretation']>
    }
    const llmHeadBeforeFinalGate = identificationRaw.fastener_interpretation.head_style
    // Nominal identification never edits the signed raw CV observations.
    // A reliable silhouette can reject an impossible semantic head choice,
    // but ambiguous geometry leaves the combined visual/CV choice intact.
    const headConsistency = evaluateHeadStyleConsistency(
      identificationRaw.fastener_interpretation.head_style,
      measurement,
    )
    identificationRaw.fastener_interpretation.head_style = headConsistency.resolved_head_style
    if (headConsistency.status === 'conflict') {
      if (headConsistency.resolved_head_style === 'flat_countersunk') {
        // Preserve what trusted physical geometry can establish, without
        // reusing a nominal length inferred for an inconsistent LLM head.
        identificationRaw.item_name = '沉頭類螺絲'
        identificationRaw.subtype = '沉頭側面輪廓（CV 量測支持）'
        identificationRaw.uncertain_fields.push('頭部實測輪廓支持沉頭，已排除原先衝突的目測頭型；公稱規格仍須依正確全長重新核對。')
      } else {
        identificationRaw.item_name = '突出頭類螺絲'
        identificationRaw.subtype = '突出頭型（具體頭型待確認）'
        identificationRaw.uncertain_fields.push('CV 輪廓排除沉頭，但仍無法唯一確認突出頭的具體種類。')
      }
    } else if (headConsistency.status === 'insufficient' &&
               ['unknown', 'other'].includes(headConsistency.resolved_head_style)) {
      identificationRaw.uncertain_fields.push('頭型證據不足，尚不能決定正確的購買長度慣例。')
    }
    const selectedLength = selectLengthFromCv(headConsistency.resolved_head_style, measurement)
    identificationRaw.fastener_interpretation.length_convention = selectedLength.convention
    // The preflight can proceed on either L candidate; once head style is
    // inferred, the FINAL gate requires the correct measured length.
    const purchaseGate = finalPurchaseGate(
      measurement,
      headConsistency.resolved_head_style,
      headConsistency,
    )
    const driveEvidence = sanitizeDriveEvidence(identificationRaw.fastener_interpretation.drive_form)
    identificationRaw.fastener_interpretation.drive_form = driveEvidence.display_form
    identificationRaw.fastener_interpretation.nominal_specification =
      stripUnverifiedDriveSizeClaims(identificationRaw.fastener_interpretation.nominal_specification)
    const llmNominalBeforeFinalGate =
      identificationRaw.fastener_interpretation.nominal_specification.trim() || null
    const measurementV2 = measurement ? toMeasurementV2(measurement) : null
    const standardsAuthority = measurementV2
      ? buildStandardsAuthorityResult(
          measurementV2,
          STANDARDS_CATALOGUE_V1,
          {
            llmNominal: llmNominalBeforeFinalGate,
            dimensionCandidate: dimensionCandidate.status === 'candidate'
              ? dimensionCandidate.specification : null,
          },
        )
      : null
    // Phase 2C shadow-only: candidates decide which semantic feature is worth
    // observing, but candidate identity never crosses into the visual sensor.
    const candidateFeatureMatrix = standardsAuthority
      ? compileCandidateFeatureMatrix(standardsAuthority.formal_candidates,CANDIDATE_FEATURE_METADATA_V1)
      : null
    const semanticDiscriminationPlan = candidateFeatureMatrix
      ? buildSemanticDiscriminationPlan(candidateFeatureMatrix,semanticEvidence)
      : null
    const targetedSemanticEvidence: TargetedSemanticEvidence[] = []
    if (semanticRequest && semanticDiscriminationPlan) {
      for (const discriminator of semanticDiscriminationPlan.discriminators) {
        if (discriminator.status !== 'targeted_observation_required') continue
        const targetedRequest=buildTargetedSemanticRequest(semanticRequest,discriminator.feature_id)
        assertTargetedRequestCandidateBlind(targetedRequest)
        const rawTargeted=await runStructuredProvider({
          provider,apiKey,model:config.model,image,
          prompt:buildTargetedSemanticPrompt(targetedRequest),
          schemaName:`hcsi_targeted_semantic_${discriminator.feature_id.replace(/[^a-z0-9]+/gi,'_')}`,
          schema:targetedSemanticSensorJsonSchema(targetedRequest) as unknown as JsonSchema,
          maxOutputTokens:1200,
        }) as RawSemanticSensorObservation
        targetedSemanticEvidence.push(buildTargetedSemanticEvidence(
          rawTargeted,targetedRequest,semanticEvidence,{model:config.model,model_version:config.model},
        ))
      }
    }
    const candidateSemanticDiscrimination = candidateFeatureMatrix
      ? buildCandidateSemanticDiscrimination(candidateFeatureMatrix,semanticEvidence,targetedSemanticEvidence)
      : null
    // Phase 2D shadow-only calibration foundation. Production registry is intentionally
    // empty until an independent real-image, specimen-split calibration corpus exists.
    // Raw semantic evidence remains immutable; no VLM score/confidence is promoted.
    const semanticCalibrationAssessment = buildSemanticCalibrationAssessment(
      semanticEvidence,targetedSemanticEvidence,PRODUCTION_SEMANTIC_CALIBRATION_REGISTRY,[],
    )
    const semanticLikelihoodEvidence = buildSemanticLikelihoodEvidence(semanticCalibrationAssessment)
    // This is the only standards-decision -> public formal specification seam.
    // A non-null invalid selected ID throws; there is deliberately no legacy fallback.
    const formalNominalProjection = standardsAuthority
      ? projectSelectedFormalNominal(standardsAuthority)
      : null
    const publicFormalDesignation = formalNominalProjection?.designation ?? null
    // Compatibility-only diagnostic. It has no standards authority.
    const standardsSolverShadow = measurementV2
      ? buildStandardsShadowResult(
          measurementV2,
          STANDARDS_CATALOGUE_V1,
          llmNominalBeforeFinalGate,
        )
      : null
    identificationRaw.purchase_description =
      stripUnverifiedDriveSizeClaims(identificationRaw.purchase_description)
    identificationRaw.specifications = identificationRaw.specifications.map(spec => ({
      ...spec,
      value: stripUnverifiedDriveSizeClaims(spec.value),
    }))
    const purchaseCompleteness = assessPurchaseSpecificationCompleteness(
      identificationRaw,
      purchaseGate,
      driveEvidence,
      standardsAuthority?.decision,
    )
    // Protruding geometry confirms the length-convention family, while the
    // final identification call supplies the finer semantic head label.
    const headSubtypeNotIndependentlyVerified =
      headConsistency.geometry_evidence === 'protruding' &&
      ['pan', 'truss', 'button', 'round'].includes(headConsistency.resolved_head_style)
    if (headSubtypeNotIndependentlyVerified) {
      identificationRaw.uncertain_fields.push(
        'CV 目前只確認突出頭類；盤頭、大扁頭等相近頭型仍以原圖判讀，購買前請核對實物頭型。'
      )
    }
    const isFastener = identificationRaw.category === 'fasteners'
    const fullFastenerSpecAllowed = isFastener &&
      purchaseGate.allowed && purchaseCompleteness.complete &&
      formalNominalProjection != null &&
      standardsAuthority?.decision.purchase_ready === true
    const optionalDrive = purchaseCompleteness.optional_unconfirmed_fields
    const baseGuidance = !isFastener
      ? '目前精確 CV 規格核驗僅支援螺絲；此結果為外觀辨識，購買前請核對實物尺寸。'
      : fullFastenerSpecAllowed
        ? optionalDrive.includes('drive_form')
          ? '尺寸規格已有可信 CV 證據；照片尚未確認驅動槽型式及尺寸，請補拍螺絲頭正面或持實物比對。'
          : optionalDrive.includes('drive_size')
            ? '尺寸規格已有可信 CV 證據；驅動槽尺寸仍須以實物確認。'
            : ''
        : purchaseGate.allowed
          ? publicCompletenessGuidance(identificationRaw.item_name)
          : publicPurchaseGuidance(purchaseGate, identificationRaw.item_name)
    const guidance = isFastener && !fullFastenerSpecAllowed &&
      dimensionCandidate.status === 'candidate'
      ? `${baseGuidance}；舊純算術尺寸表示 ${dimensionCandidate.specification} 僅保留為 non-authoritative diagnostic。正式 nominal 候選只能來自 standards_authority.formal_candidates；目前尚未 deterministic 選出 winner。`
      : baseGuidance
    if (fullFastenerSpecAllowed && formalNominalProjection) {
      // Legacy LLM text is never reused across the authority seam. All public
      // formal nominal surfaces are rebuilt by the deterministic projection helper.
      const publicFormal = buildPublicFormalSurfaces(
        identificationRaw.item_name,
        formalNominalProjection,
        { driveFormUnconfirmed:optionalDrive.includes('drive_form') },
      )
      identificationRaw.fastener_interpretation.nominal_specification = publicFormal.nominal_specification!
      identificationRaw.purchase_description = publicFormal.purchase_description!
      identificationRaw.specifications = [
        ...identificationRaw.specifications.filter(spec =>
          spec.evidence_level !== 'estimated' || !/\\d/.test(spec.value)
        ),
        publicFormal.specification_item!,
      ]
    }
    if (isFastener && !fullFastenerSpecAllowed) {
      identificationRaw.fastener_interpretation.nominal_specification = ''
      identificationRaw.purchase_description = guidance
      // Never display speculative numeric specs when full evidence is blocked.
      identificationRaw.specifications = identificationRaw.specifications.filter(
        spec => spec.evidence_level === 'observed' && !/\\d/.test(spec.value)
      )
      identificationRaw.most_likely_identification = identificationRaw.item_name
      identificationRaw.identification_status = identificationRaw.identification_status === 'unidentifiable'
        ? 'unidentifiable' : 'partial'
    }
    // Only the deterministic CV response can create public "measured" items.
    // When the complete purchase gate fails, preserve independently credible
    // physical dimensions; do not confuse them with an inferred nominal size.
    const visibleChecks = measurement?.confidence_evaluation.checks ?? []
    const observableCaptureUsable = ['scale_available', 'scale_observation_support',
      'perspective_risk', 'object_geometry', 'segmentation_risk'].every(id =>
      visibleChecks.some(check => check.id === id && check.status === 'passed'))
      && !visibleChecks.some(check =>
        ['same_plane', 'near_overhead_capture'].includes(check.id) && check.status === 'failed')
    const cvSpecifications = isFastener && observableCaptureUsable && measurement?.measurement_status === 'valid'
      ? ([
          ['D', '螺紋外徑'], ['P', '螺距'], ['L_underhead', '頭下長度'],
          ['L_overall', '全長'], ['K', '頭部高度'], ['DK', '頭部最大寬度'],
        ] as const).flatMap(([key, label]) => {
          const d = measurement.dimensions?.[key]
          const trusted = d?.status === 'measured' && typeof d.value_mm === 'number' &&
            Number.isFinite(d.value_mm) && d.value_mm > 0 &&
            d.risk_signals.every(reason =>
              ['same_plane_unverified', 'capture_orientation_unverified',
                'object_ruler_alignment_unknown'].includes(reason))
          return trusted ? [{ label, value: `${d.value_mm} mm`, evidence_level: 'measured' as const }] : []
        })
      : []
    identificationRaw.specifications = [
      ...cvSpecifications,
      ...identificationRaw.specifications.filter(spec => spec.evidence_level !== 'measured'),
    ]
    // Slot form is image-observed (when visible); slot SIZE has no CV measurement
    // or verified standards-table derivation in this version.
    identificationRaw.specifications = identificationRaw.specifications.filter(
      spec => !/^(S\\s*[:：／]?|驅動(?:槽)?(?:尺寸|規格)|槽孔尺寸)/i.test(spec.label)
    )
    if (identificationRaw.category === 'fasteners') {
      if (!driveEvidence.form_observed) {
        identificationRaw.uncertain_fields.push('驅動槽型式及尺寸：目前角度無法確認，請補拍螺絲頭正面。')
      } else if (!/^(none|no drive|不適用|外六角)$/i.test(driveEvidence.display_form)) {
        identificationRaw.uncertain_fields.push('驅動槽尺寸：尚無可信實測或驗證標準表，請補拍螺絲頭正面或持實物確認。')
      }
    }
    identificationRaw.uncertain_fields = [...new Set(identificationRaw.uncertain_fields)]
    const dimensions = measurement?.dimensions ?? {}
    const response = {
      provider, model: config.model, result: identificationRaw, measurement,
      semantic_evidence: semanticEvidence,
      semantic_evidence_error: semanticEvidenceError,
      candidate_feature_matrix: candidateFeatureMatrix,
      semantic_discrimination_plan: semanticDiscriminationPlan,
      targeted_semantic_evidence: targetedSemanticEvidence,
      candidate_semantic_discrimination: candidateSemanticDiscrimination,
      semantic_calibration_assessment: semanticCalibrationAssessment,
      semantic_likelihood_evidence: semanticLikelihoodEvidence,
      standards_authority: standardsAuthority,
      formal_nominal_projection: formalNominalProjection,
      standards_solver_shadow: standardsSolverShadow, // deprecated diagnostic compatibility only
      user_guidance: {
        purchase_ready: fullFastenerSpecAllowed,
        message: guidance,
        dimension_candidate: fullFastenerSpecAllowed ? null : dimensionCandidate.specification,
        dimension_candidate_status: dimensionCandidate.status === 'candidate'
          ? 'dimension_only_not_purchase_ready'
          : 'unavailable',
        formal_nominal_source: 'versioned_standards_solver',
        selected_candidate_id: standardsAuthority?.decision.selected_candidate_id ?? null,
        standards_decision_status: standardsAuthority?.decision.status ?? 'unavailable',
        actions: fullFastenerSpecAllowed
          ? optionalDrive.length ? ['補拍螺絲頭正面或持實物核對驅動槽'] : []
          : ['依提示補拍', '購買前以實物核對必要尺寸'],
      },
      specification_evidence: {
        cv_raw_measurements: dimensions,
        llm_inferred_nominal: {
          value: llmNominalBeforeFinalGate,
          authority: 'non_authoritative',
          use: 'diagnostic_only',
        },
        llm_semantic_candidate_before_gates: {
          head_style: llmHeadBeforeFinalGate,
          nominal_specification: llmNominalBeforeFinalGate,
        },
        dimension_candidate: {
          ...dimensionCandidate,
          authority: 'non_authoritative',
          use: 'diagnostic_only',
        },
        standards_authority: standardsAuthority,
        formal_nominal_projection: formalNominalProjection,
        purchase_gate: purchaseGate,
        purchase_completeness: purchaseCompleteness,
        head_style_consistency: headConsistency,
        drive_evidence: driveEvidence,
        cv_grounding_basis: cvGroundingBasis,
        standard_table_derived: standardsAuthority?.formal_candidates ?? [],
        standards_solver_shadow: standardsSolverShadow, // deprecated diagnostic compatibility only
        not_obtained: [
          ...REQUIRED_INFERENCE_DIMENSIONS.filter(key => dimensions[key]?.status !== 'measured'),
        ],
        not_implemented: ['T'],
      },
      selected_length: selectedLength,
      measurement_source: proofHasSemanticRoi ? 'signed_preflight_reused' : measurement ? 'server_cv_executed_with_semantic_roi' : 'service_unavailable',
      semantic_roi_source: proofHasSemanticRoi ? 'signed_preflight' : semanticLocalization ? `${provider}_localizer` : 'none',
      measurement_service_error: measurementServiceError,
      schema_version: 'hcsi.cv-first.v2',
    }
    console.info('[HCSI] CV-first internal diagnostics', {
      provider, purchaseGate, purchaseCompleteness, headConsistency, driveEvidence,
      dimensionCandidate, standardsAuthority,
      semanticEvidenceStatus: semanticEvidence ? 'available' : 'unavailable',
      measurementServiceError, measurementReasonCodes: measurement?.reason_codes ?? [],
    })
    await logResult(provider, config.model, identificationRaw.category, identificationRaw, measurement)
    return NextResponse.json(response)
  } catch (error) {
    console.error(`[HCSI] ${provider} analyze failed:`, error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '辨識失敗' }, { status: 502 })
  }
}

async function runStructuredProvider(args: { provider: Provider; apiKey: string; model: string; image: string; prompt: string; schemaName: string; schema: JsonSchema; maxOutputTokens: number }) {
  if (args.provider === 'gemini') return runGemini(args)
  return runResponsesApi(args)
}

async function runGemini(args: { apiKey: string; model: string; image: string; prompt: string; schemaName: string; schema: JsonSchema; maxOutputTokens: number }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: args.prompt }, { inline_data: { mime_type: 'image/jpeg', data: args.image } }] }], generationConfig: { maxOutputTokens: args.maxOutputTokens, responseMimeType: 'application/json', responseJsonSchema: args.schema, thinkingConfig: { thinkingLevel: 'medium' } } }),
  })
  if (!response.ok) { const upstreamError = await response.text(); console.error('[HCSI] Gemini upstream error:', response.status, upstreamError.slice(0, 1600)); throw new Error('Gemini 分析服務暫時無法使用。') }
  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.find((part: any) => typeof part?.text === 'string')?.text
  return parseJsonText(text, 'Gemini')
}

async function runResponsesApi(args: { provider: Provider; apiKey: string; model: string; image: string; prompt: string; schemaName: string; schema: JsonSchema; maxOutputTokens: number }) {
  const isGrok = args.provider === 'grok'
  const endpoint = isGrok ? 'https://api.x.ai/v1/responses' : 'https://api.openai.com/v1/responses'
  const label = isGrok ? 'Grok' : 'OpenAI'
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.apiKey}` },
    body: JSON.stringify({ model: args.model, store: false, reasoning: { effort: 'medium' }, max_output_tokens: args.maxOutputTokens, text: { format: { type: 'json_schema', name: args.schemaName, schema: args.schema, strict: true } }, input: [{ role: 'user', content: [{ type: 'input_text', text: args.prompt }, { type: 'input_image', image_url: `data:image/jpeg;base64,${args.image}`, detail: 'high' }] }] }),
  })
  if (!response.ok) { const upstreamError = await response.text(); console.error(`[HCSI] ${label} upstream error:`, response.status, upstreamError.slice(0, 1600)); throw new Error(`${label} 分析服務暫時無法使用。`) }
  const data = await response.json()
  const text = data?.output?.flatMap((item: any) => item?.content ?? []).find((item: any) => item?.type === 'output_text')?.text
  return parseJsonText(text, label)
}

function parseJsonText(text: unknown, label: string) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${label} 沒有回傳可解析的結果`)
  try { return JSON.parse(text) } catch { throw new Error(`${label} 回傳的 JSON 無法解析`) }
}

async function logResult(provider: Provider, model: string, category: string, result: IdentificationResult, measurement: MeasurementResult | null) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return
  try {
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
    await supabase.from('identification_logs').insert({ provider, model, category, item_name: result.item_name, identification_status: result.identification_status, result, measurement })
  } catch (error) { console.warn('[HCSI] unable to persist identification log:', error) }
}
