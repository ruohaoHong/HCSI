export interface ImageDimensions {width_px:number;height_px:number;format:'jpeg'|'png'|'webp'}

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
    if(buffer.length>=30&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'){
      const chunk=buffer.toString('ascii',12,16)
      if(chunk==='VP8X'&&buffer.length>=30){
        const width=1+buffer[24]+(buffer[25]<<8)+(buffer[26]<<16)
        const height=1+buffer[27]+(buffer[28]<<8)+(buffer[29]<<16)
        return width>0&&height>0?{width_px:width,height_px:height,format:'webp'}:null
      }
      if(chunk==='VP8L'&&buffer.length>=25&&buffer[20]===0x2f){
        const b1=buffer[21],b2=buffer[22],b3=buffer[23],b4=buffer[24]
        const width=1+(b1|((b2&0x3f)<<8))
        const height=1+((b2>>6)|(b3<<2)|((b4&0x0f)<<10))
        return width>0&&height>0?{width_px:width,height_px:height,format:'webp'}:null
      }
      if(chunk==='VP8 '&&buffer.length>=30&&buffer[23]===0x9d&&buffer[24]===0x01&&buffer[25]===0x2a){
        const width=buffer.readUInt16LE(26)&0x3fff
        const height=buffer.readUInt16LE(28)&0x3fff
        return width>0&&height>0?{width_px:width,height_px:height,format:'webp'}:null
      }
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
