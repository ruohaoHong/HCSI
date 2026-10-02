import {
  readImageDimensionsFromBase64,
  type ImageDimensions,
} from './semantic-image-dimensions'
import {
  buildSemanticObservationPixelGeometry,
  type PixelBoundingBox,
  type SemanticObservationPixelGeometry,
  type SemanticObservationRegionType,
} from './semantic-observation-pixel-geometry'

export { readImageDimensionsFromBase64 }
export type { ImageDimensions }

export interface SemanticRuntimeQualityContext {
  visibility:string
  capture_type:string
  viewpoint:string
  crop_type:string
  width_px:number|null
  height_px:number|null
  occlusion_condition:string
  glare_condition:string
  pixel_geometry?:SemanticObservationPixelGeometry
}

export interface RuntimeImageMetadata {
  /** Backward-compatible alias for the actual sensor input bytes. */
  image_base64?:string|null
  source_image_base64?:string|null
  observation_image_base64?:string|null
  crop_ref?:string|null
  observation_region_type?:SemanticObservationRegionType|null
  observation_bbox_px?:PixelBoundingBox|null
  effective_input_width_px?:number|null
  effective_input_height_px?:number|null
  resize_target?:{width_px:number;height_px:number}|null
  width_px?:number|null
  height_px?:number|null
  capture_type?:string|null
  viewpoint?:string|null
  crop_type?:string|null
  occlusion_condition?:string|null
  glare_condition?:string|null
  geometry_provenance?:string|null
}

export function buildSemanticRuntimeQuality(
  visibility:string,
  metadata:RuntimeImageMetadata={},
):SemanticRuntimeQualityContext{
  const observationImage=metadata.observation_image_base64??metadata.image_base64??null
  const sourceImage=metadata.source_image_base64??metadata.image_base64??observationImage
  const regionType=metadata.observation_region_type??
    (metadata.crop_ref==='full_image_1'
      ?'full_image'
      :metadata.crop_ref
        ?'full_image_with_roi_reference'
        :observationImage
          ?'full_image'
          :'unknown')
  const explicitWidth=typeof metadata.width_px==='number'&&metadata.width_px>0?metadata.width_px:null
  const explicitHeight=typeof metadata.height_px==='number'&&metadata.height_px>0?metadata.height_px:null
  const geometry=buildSemanticObservationPixelGeometry({
    source_image_base64:sourceImage,
    observation_image_base64:observationImage,
    observation_region_type:regionType,
    observation_bbox_px:metadata.observation_bbox_px??null,
    effective_input_width_px:metadata.effective_input_width_px??explicitWidth,
    effective_input_height_px:metadata.effective_input_height_px??explicitHeight,
    resize_target:metadata.resize_target??null,
    geometry_provenance:metadata.geometry_provenance??'semantic_runtime_quality',
  })
  const width=geometry.effective_input_width_px
  const height=geometry.effective_input_height_px
  const cropType=metadata.crop_type??regionType
  const captureType=metadata.capture_type??(observationImage?'single_image':'unknown')
  return {
    visibility,
    capture_type:captureType,
    viewpoint:metadata.viewpoint??'unknown',
    crop_type:cropType,
    width_px:width,
    height_px:height,
    occlusion_condition:metadata.occlusion_condition??'unknown',
    glare_condition:metadata.glare_condition??'unknown',
    pixel_geometry:geometry,
  }
}

export function semanticObservationQualityMetadata(
  reasonCodes:readonly string[],
  imageBase64:string|null,
  cropRef:string,
):RuntimeImageMetadata{
  const regionType:SemanticObservationRegionType=
    cropRef==='full_image_1'?'full_image':'full_image_with_roi_reference'
  return {
    source_image_base64:imageBase64,
    observation_image_base64:imageBase64,
    crop_ref:cropRef,
    observation_region_type:regionType,
    capture_type:imageBase64?'single_image':null,
    viewpoint:null,
    crop_type:regionType,
    occlusion_condition:reasonCodes.includes('OCCLUDED')?'occluded':'unknown',
    glare_condition:reasonCodes.includes('GLARE')?'glare_present':'unknown',
    geometry_provenance:cropRef==='full_image_1'
      ?'provider_received_full_image'
      :'provider_received_full_image_with_roi_reference',
  }
}
