export interface SemanticRuntimeQualityContext {
  visibility:string
  capture_type:string
  viewpoint:string
  crop_type:string
  width_px:number|null
  height_px:number|null
  occlusion_condition:string
  glare_condition:string
}

export interface RuntimeImageMetadata {
  image_base64?:string|null
  crop_ref?:string|null
  width_px?:number|null
  height_px?:number|null
  capture_type?:string|null
  viewpoint?:string|null
  crop_type?:string|null
  occlusion_condition?:string|null
  glare_condition?:string|null
}

export interface ImageDimensions {width_px:number;height_px:number;format:'jpeg'|'png'}

function cleanBase64(value:string){
  const comma=value.indexOf(',')
  return comma>=0?value.slice(comma+1):value
}

export function readImageDimensionsFromBase64(value:string):ImageDimensions|null{
  try{
    const buffer=Buffer.from(cleanBase64(value),'base64')
    if(buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
      const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20)
      return width>0&&height>0?{width_px:width,height_px:height,format:'png'}:null
    }
    if(buffer.length>=4&&buffer[0]===0xff&&buffer[1]===0xd8){
      let offset=2
      const sof=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf])
      while(offset+8<buffer.length){
        if(buffer[offset]!==0xff){offset++;continue}
        while(offset<buffer.length&&buffer[offset]===0xff)offset++
        const marker=buffer[offset++]
        if(marker===0xd8||marker===0xd9)continue
        if(offset+2>buffer.length)break
        const length=buffer.readUInt16BE(offset)
        if(length<2||offset+length>buffer.length)break
        if(sof.has(marker)&&length>=7){
          const height=buffer.readUInt16BE(offset+3),width=buffer.readUInt16BE(offset+5)
          return width>0&&height>0?{width_px:width,height_px:height,format:'jpeg'}:null
        }
        offset+=length
      }
    }
    return null
  }catch{return null}
}

export function buildSemanticRuntimeQuality(
  visibility:string,
  metadata:RuntimeImageMetadata={},
):SemanticRuntimeQualityContext{
  const parsed=metadata.image_base64?readImageDimensionsFromBase64(metadata.image_base64):null
  const width=typeof metadata.width_px==='number'&&metadata.width_px>0?metadata.width_px:parsed?.width_px??null
  const height=typeof metadata.height_px==='number'&&metadata.height_px>0?metadata.height_px:parsed?.height_px??null
  const cropType=metadata.crop_type??
    (metadata.crop_ref==='full_image_1'?'full_image':metadata.crop_ref?'target_region_reference':'unknown')
  const captureType=metadata.capture_type??(metadata.image_base64?'single_image':'unknown')
  return {
    visibility,
    capture_type:captureType,
    viewpoint:metadata.viewpoint??'unknown',
    crop_type:cropType,
    width_px:width,
    height_px:height,
    occlusion_condition:metadata.occlusion_condition??'unknown',
    glare_condition:metadata.glare_condition??'unknown',
  }
}

export function semanticObservationQualityMetadata(
  reasonCodes:readonly string[],
  imageBase64:string|null,
  cropRef:string,
):RuntimeImageMetadata{
  return {
    image_base64:imageBase64,
    crop_ref:cropRef,
    capture_type:imageBase64?'single_image':null,
    viewpoint:null,
    crop_type:cropRef==='full_image_1'?'full_image':'target_region_reference',
    occlusion_condition:reasonCodes.includes('OCCLUDED')?'occluded':'unknown',
    glare_condition:reasonCodes.includes('GLARE')?'glare_present':'unknown',
  }
}
