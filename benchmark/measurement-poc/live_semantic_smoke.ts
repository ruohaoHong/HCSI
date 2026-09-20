import fs from 'node:fs'

import {
  buildRoutingPrompt,
  isRoutingResult,
  ROUTING_JSON_SCHEMA,
} from '../../lib/identification'
import { resolveMeasurementPlan } from '../../lib/measurement-plan-resolver'

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENAI_API_KEY is unavailable')

  const image = fs
    .readFileSync('benchmark/measurement-poc/fixtures/generated/bolt_ruler_case.jpg.b64', 'utf8')
    .trim()

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.6-sol',
      store: false,
      reasoning: { effort: 'medium' },
      max_output_tokens: 3200,
      text: {
        format: {
          type: 'json_schema',
          name: 'hcsi_semantic_measurement_planner_live_smoke',
          schema: ROUTING_JSON_SCHEMA,
          strict: true,
        },
      },
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${image}`,
              detail: 'high',
            },
            {
              type: 'input_text',
              text: buildRoutingPrompt(),
            },
          ],
        },
      ],
    }),
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`OpenAI request failed: HTTP ${response.status}: ${raw.slice(0, 1000)}`)
  }

  const data = JSON.parse(raw)
  const outputText = data?.output
    ?.flatMap((item: any) => item?.content ?? [])
    .find((item: any) => item?.type === 'output_text')?.text

  if (typeof outputText !== 'string' || !outputText.trim()) {
    throw new Error('OpenAI returned no structured planner output')
  }

  const routing = JSON.parse(outputText)
  if (!isRoutingResult(routing)) {
    throw new Error(`Planner output failed HCSI routing validation: ${outputText}`)
  }

  const target = routing.semantic_vision.target_region
  const reference = routing.semantic_vision.reference_region
  if (routing.category !== 'fasteners') {
    throw new Error(`Expected fasteners category, got ${routing.category}`)
  }
  if (!target.present || target.confidence < 0.55) {
    throw new Error(`Target semantic region was not usable: ${JSON.stringify(target)}`)
  }
  if (!reference.present || reference.confidence < 0.55) {
    throw new Error(`Reference semantic region was not usable: ${JSON.stringify(reference)}`)
  }

  const resolved = resolveMeasurementPlan(routing.measurement_plan, {
    category: routing.category,
    head_style: routing.semantic_vision.head_style,
  })

  const output = {
    routing,
    resolved_measurement_plan: resolved,
  }
  fs.writeFileSync('semantic-live-output.json', JSON.stringify(output, null, 2))

  console.log(JSON.stringify({
    category: routing.category,
    object_hint: routing.object_hint,
    head_style: routing.semantic_vision.head_style,
    target_region: target,
    reference_region: reference,
    length_convention: resolved.length_convention,
    executable_steps: resolved.executable_steps.map((step) => ({
      operation: step.operation,
      inputs: step.inputs,
    })),
  }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
