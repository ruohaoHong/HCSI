import { readImageDimensionsFromBase64 } from './semantic-runtime-quality'

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

export function buildSemanticObservationPixelGeometry(
  input:BuildSemanticObservationPixelGeometryInput,
):SemanticObservationPixelGeometry{
  const source=input.source_image_base64?readImageDimensionsFromBase64(input.source_image_base64):null
  const observed=input.observation_image_base64?readImageDimensionsFromBase64(input.observation_image_base64):null
  const region=input.observation_region_type??'unknown'
  let effectiveWidth=positive(input.effective_input_width_px)?input.effective_input_width_px:null
  let effectiveHeight=positive(input.effective_input_height_px)?input.effective_input_height_px:null

  if(effectiveWidth===null||effectiveHeight===null){
    if(region==='physical_crop_input'){
      effectiveWidth=observed?.width_px??null
      effectiveHeight=observed?.height_px??null
    }else if(region==='full_image'||region==='full_image_with_roi_reference'){
      const full=observed??source
      effectiveWidth=full?.width_px??null
      effectiveHeight=full?.height_px??null
    }
  }

  const resizeTarget=input.resize_target??null
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
