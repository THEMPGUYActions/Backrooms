export function isTouchControlsDevice(){
  const touchPoints=Number.isFinite(navigator.maxTouchPoints)?navigator.maxTouchPoints:0;
  const coarse=matchMedia("(pointer:coarse)").matches;
  const fine=matchMedia("(pointer:fine)").matches;
  return coarse||(touchPoints>0&&!fine);
}
