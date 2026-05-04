// Stub video-feedback generator. Returns plausible-looking technique
// notes per stroke. Replace with a real model when ready.
function genFeedback(stroke) {
  const t = {
    Freestyle: { body_position: 'Good', arm_technique: 'Strong', kick: 'Consistent', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Catch', 'Rotation', 'Kick'][Math.floor(Math.random() * 3)] },
    Backstroke: { body_position: 'Good', arm_technique: 'Clean', kick: 'Steady', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Hip rotation', 'Entry', 'Kick'][Math.floor(Math.random() * 3)] },
    Breaststroke: { body_position: 'Good', arm_technique: 'Strong', kick: 'Powerful', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Glide', 'Timing', 'Pullout'][Math.floor(Math.random() * 3)] },
    Butterfly: { body_position: 'Good', arm_technique: 'Strong', kick: 'Two kicks', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Second kick', 'Hip drive', 'Breathing'][Math.floor(Math.random() * 3)] },
    IM: { transitions: 'Smooth', pacing: 'Good', overall_score: 7 + Math.floor(Math.random() * 3), priority_focus: ['Turns', 'Pacing', 'Weakest stroke'][Math.floor(Math.random() * 3)] }
  };
  return t[stroke] || t.Freestyle;
}

module.exports = { genFeedback };
