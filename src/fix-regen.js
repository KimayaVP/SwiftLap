// This shows the fix needed in checkShouldRegenerate function

function checkShouldRegenerate(oldData, newData) {
  if (!oldData) return true;
  
  // Check if goal changed (stroke/distance)
  if (oldData.goalStroke !== newData.goalStroke) return true;
  if (oldData.goalDistance !== newData.goalDistance) return true;
  
  // Check if gap changed significantly
  if (Math.abs((oldData.goalGap || 0) - (newData.goalGap || 0)) > 3) return true;
  
  // Check if consistency changed significantly
  if (Math.abs((oldData.consistency || 0) - (newData.consistencyScore || 0)) > 20) return true;
  
  return false;
}
