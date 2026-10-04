export const SEMANTIC_CALIBRATION_STATISTICS_VERSION='hcsi.semantic-calibration-statistics.v1' as const

function assertBinomialInputs(errors:number,trials:number,confidenceLevel:number){
  if(!Number.isInteger(errors)||!Number.isInteger(trials)||trials<=0||errors<0||errors>trials){
    throw new Error('invalid_binomial_counts')
  }
  if(!Number.isFinite(confidenceLevel)||confidenceLevel<=0||confidenceLevel>=1){
    throw new Error('invalid_confidence_level')
  }
}

function logBinomialCoefficient(n:number,k:number):number{
  const m=Math.min(k,n-k)
  let value=0
  for(let i=1;i<=m;i++) value+=Math.log(n-m+i)-Math.log(i)
  return value
}

function binomialCdf(errors:number,trials:number,p:number):number{
  if(p<=0) return 1
  if(p>=1) return errors>=trials?1:0
  const logP=Math.log(p)
  const logQ=Math.log1p(-p)
  const logs:number[]=[]
  let maxLog=-Infinity
  for(let k=0;k<=errors;k++){
    const logTerm=logBinomialCoefficient(trials,k)+k*logP+(trials-k)*logQ
    logs.push(logTerm)
    if(logTerm>maxLog) maxLog=logTerm
  }
  const scaled=logs.reduce((sum,x)=>sum+Math.exp(x-maxLog),0)
  return Math.exp(maxLog)*scaled
}

/**
 * Exact one-sided Clopper-Pearson upper confidence bound for a binomial error rate.
 * This inverts the exact binomial CDF; it does not use a normal/Wald approximation.
 */
export function exactOneSidedClopperPearsonUpper(
  errors:number,
  trials:number,
  confidenceLevel:number,
):number{
  assertBinomialInputs(errors,trials,confidenceLevel)
  const alpha=1-confidenceLevel
  if(errors===trials) return 1
  if(errors===0) return 1-Math.pow(alpha,1/trials)

  let low=errors/trials
  let high=1
  for(let i=0;i<120;i++){
    const mid=(low+high)/2
    if(binomialCdf(errors,trials,mid)>alpha) low=mid
    else high=mid
  }
  return high
}
