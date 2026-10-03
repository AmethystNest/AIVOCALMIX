// iOS Safari mutes Web Audio while the ringer/silent switch is on unless the
// page declares itself as media playback. navigator.audioSession (Audio Session
// API) lets it do that; browsers without the API are left untouched.
(function(){
  try {
    const session = navigator.audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch (e) {}
})();
