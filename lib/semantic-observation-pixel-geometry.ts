import { readImageDimensionsFromBase64 } from './semantic-image-dimensions'

export const SEMANTIC_OBSERVATION_PIXEL_GEOMETRY_SCHEMA='hcsi.semantic-observation-pixel-geometry.v1' as const
export type SemanticObservationRegionType=
  |'full_image'
  |'full_image_with_roi_reference'
  |'physical_crop_input'
  |'unknown'

export interface PixelBoundingBox {
  x_px:number
  y_px:number
  width_px:number
  height_px:number
}

export interface SemanticObservationPixelGeometry {
  schema_version:typeof SEMANTIC_OBSERVATION_PIXEL_GEOMETRY_SCHEMA
  source_image_width_px:number|null
  source_image_height_px:number|null
  observation_region_type:SemanticObservationRegionType
  observation_bbox_px:PixelBoundingBox|null
  effective_input_width_px:number|null
  effective_input_height_px:number|null
  resize_applied:boolean|null
  resize_target:{width_px:number;height_px:number}|null
  geometry_provenance:string
}

export interface BuildSemanticObservationPixelGeometryInput {
  source_image_base64?:string|null
  observation_image_base64?:string|null
  observation_region_type?:SemanticObservationRegionType|null
  observation_bbox_px?:PixelBoundingBox|null
  effective_input_width_px?:number|null
  effective_input_height_px?:number|null
  resize_target?:{width_px:number;height_px:number}|null
  geometry_provenance?:string|null
}

function positive(value:unknown):value is number{
  return typeof value==='number'&&Number.isFinite(value)&&value>0
}

function assertMatchesActualDimension(
  explicit:number|null,
  actual:number,
  axis:'width'|'height',
){
  if(explicit!==null&&explicit!==actual){
    throw new Error(`semantic_observation_geometry_conflict:effective_${axis}_mismatch`)
  }
}

export function buildSemanticObservationPixelGeometry(
  input:BuildSemanticObservationPixelGeometryInput,
):SemanticObservationPixelGeometry{
  const source=input.source_image_base64?readImageDimensionsFromBase64(input.source_image_base64):null
  const observed=input.observation_image_base64?readImageDimensionsFromBase64(input.observation_image_base64):null
  const region=input.observation_region_type??'unknown'
  const explicitWidth=positive(input.effective_input_width_px)?input.effective_input_width_px:null
  const explicitHeight=positive(input.effective_input_height_px)?input.effective_input_height_px:null
  const resizeTarget=input.resize_target??null

  let effectiveWidth:number|null=null
  let effectiveHeight:number|null=null

  if(observed){
    // Actual bytes received by the semantic sensor are authoritative whenever
    // dimensions can be decoded. Metadata may confirm them but never override.
    assertMatchesActualDimension(explicitWidth,observed.width_px,'width')
    assertMatchesActualDimension(explicitHeight,observed.height_px,'height')
    if(resizeTarget&&(
      resizeTarget.width_px!==observed.width_px||
      resizeTarget.height_px!==observed.height_px
    )){
      throw new Error('semantic_observation_geometry_conflict:resize_target_mismatch')
    }
    effectiveWidth=observed.width_px
    effectiveHeight=observed.height_px
  }else if(region==='full_image'||region==='full_image_with_roi_reference'){
    const full=source
    if(full){
      assertMatchesActualDimension(explicitWidth,full.width_px,'width')
      assertMatchesActualDimension(explicitHeight,full.height_px,'height')
      if(resizeTarget&&(
        resizeTarget.width_px!==full.width_px||
        resizeTarget.height_px!==full.height_px
      )){
        throw new Error('semantic_observation_geometry_conflict:resize_target_mismatch')
      }
      effectiveWidth=full.width_px
      effectiveHeight=full.height_px
    }else{
      effectiveWidth=explicitWidth
      effectiveHeight=explicitHeight
    }
  }else{
    // Without decodable observation bytes, metadata remains only a fallback.
    // physical_crop_input must never inherit source-image dimensions.
    effectiveWidth=explicitWidth
    effectiveHeight=explicitHeight
  }

  const resizeApplied=resizeTarget
    ? effectiveWidth!==null&&effectiveHeight!==null
      ? effectiveWidth===resizeTarget.width_px&&effectiveHeight===resizeTarget.height_px
      : null
    : false

  return {
    schema_version:SEMANTIC_OBSERVATION_PIXEL_GEOMETRY_SCHEMA,
    source_image_width_px:source?.width_px??null,
    source_image_height_px:source?.height_px??null,
    observation_region_type:region,
    observation_bbox_px:input.observation_bbox_px??null,
    effective_input_width_px:effectiveWidth,
    effective_input_height_px:effectiveHeight,
    resize_applied:resizeApplied,
    resize_target:resizeTarget,
    geometry_provenance:input.geometry_provenance??'runtime_metadata',
  }
}
