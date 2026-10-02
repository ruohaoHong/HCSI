export const SEMANTIC_CALIBRATION_METRICS_VERSION='hcsi.semantic-calibration-metrics.v1' as const
export interface ReliabilityBin {lower:number;upper:number;count:number;mean_confidence:number|null;accuracy:number|null;absolute_gap:number|null}
function clampProbability(p:number){if(!Number.isFinite(p)||p<0||p>1)throw new Error('invalid_probability');return p}
export function binaryBrierScore(probabilities:number[],labels:number[]):number{
 if(probabilities.length!==labels.length||!probabilities.length)throw new Error('invalid_metric_samples')
 return probabilities.reduce((s,p,i)=>s+(clampProbability(p)-labels[i])**2,0)/probabilities.length
}
export function multiclassBrierScore(probabilities:number[][],labels:number[]):number{
 if(!probabilities.length||probabilities.length!==labels.length)throw new Error('invalid_metric_samples')
 return probabilities.reduce((sum,row,i)=>{if(labels[i]<0||labels[i]>=row.length)throw new Error('invalid_label');return sum+row.reduce((s,p,k)=>s+(clampProbability(p)-(k===labels[i]?1:0))**2,0)},0)/probabilities.length
}
export function multiclassLogLoss(probabilities:number[][],labels:number[],epsilon=1e-15):number{
 if(!probabilities.length||probabilities.length!==labels.length)throw new Error('invalid_metric_samples')
 return -probabilities.reduce((s,row,i)=>{const p=clampProbability(row[labels[i]]);return s+Math.log(Math.min(1-epsilon,Math.max(epsilon,p)))},0)/probabilities.length
}
export function reliabilityBins(confidences:number[],correct:number[],binCount=10):ReliabilityBin[]{
 if(confidences.length!==correct.length||!confidences.length||!Number.isInteger(binCount)||binCount<1)throw new Error('invalid_metric_samples')
 const bins:ReliabilityBin[]=[]
 for(let b=0;b<binCount;b++){const lo=b/binCount,hi=(b+1)/binCount;const idx=confidences.map((c,i)=>({c:clampProbability(c),i})).filter(x=>x.c>=lo&&(b===binCount-1?x.c<=hi:x.c<hi));const n=idx.length;const mc=n?idx.reduce((s,x)=>s+x.c,0)/n:null;const ac=n?idx.reduce((s,x)=>s+correct[x.i],0)/n:null;bins.push({lower:lo,upper:hi,count:n,mean_confidence:mc,accuracy:ac,absolute_gap:n?Math.abs(mc!-ac!):null})}
 return bins
}
export function expectedCalibrationError(confidences:number[],correct:number[],binCount=10):number{
 const bins=reliabilityBins(confidences,correct,binCount),n=confidences.length
 return bins.reduce((s,b)=>s+(b.count/n)*(b.absolute_gap??0),0)
}
