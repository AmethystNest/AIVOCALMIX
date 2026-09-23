/* D43: dependency-free reset. Runs independently from the main app initializer. */
window.vmHardResetDefaultsD43 = function(event){
  if(event){ event.preventDefault(); event.stopPropagation(); }
  var selectDefaults={mixPreset:'natural',vocalDistance:'natural',harmonyPreset:'natural',instTreatment:'natural'};
  Object.keys(selectDefaults).forEach(function(id){
    var el=document.getElementById(id), value=selectDefaults[id];
    if(!el) return;
    for(var i=0;i<el.options.length;i++){
      if(el.options[i].value===value){ el.selectedIndex=i; break; }
    }
    el.value=value;
  });
  var checks={
    vocalAirEnhance:false,vocalBreathControl:false,vocalSectionBalance:false,vocalDucking:false,
    vocalMultiband:false,vocalParallelComp:false,vocalRecordingSource:false,vocalReverbAuto:true,
    vocalThickenDelay:false,vocalReverbTailGate:false,vocalClipRepair:false
  };
  Object.keys(checks).forEach(function(id){ var el=document.getElementById(id); if(el) el.checked=checks[id]; });

  /* Update visible descriptions without requiring the main JS to have initialized. */
  var vocalMeaning=document.getElementById('uploadPresetMeaning');
  if(vocalMeaning) vocalMeaning.textContent='自然なバランスを基準に、解析結果に応じて必要な処理だけを加えます。';
  var dist=document.getElementById('vocalDistanceDesc');
  if(dist) dist.textContent='標準：声を前に出しすぎず、伴奏の中に自然に馴染む位置。';
  var harm=document.getElementById('uploadHarmonyPresetDesc');
  if(harm) harm.textContent='Mainを支えながら、自然に馴染ませる標準設定。';
  var inst=document.getElementById('instTreatmentDesc');
  if(inst) inst.textContent='解析結果に基づく判断ではなく、既に完成された伴奏を前提にした固定量の調整です。';

  /* Replace stored UI prefs directly so reload cannot restore the old choices. */
  try{
    var key='aivocalmix.v80.uiPrefs.v1';
    var obj={};
    try{ obj=JSON.parse(localStorage.getItem(key)||'{}')||{}; }catch(_){ obj={}; }
    Object.keys(selectDefaults).forEach(function(id){ obj[id]=selectDefaults[id]; });
    Object.keys(checks).forEach(function(id){ obj[id]=checks[id]; });
    localStorage.setItem(key,JSON.stringify(obj));
  }catch(_){}

  /* If the main app is alive, refresh its dependent displays too. */
  try{ if(typeof updateUploadPresetDetail==='function') updateUploadPresetDetail(); }catch(_){}
  try{ if(typeof updateVocalDistanceDescription==='function') updateVocalDistanceDescription(); }catch(_){}
  try{ if(typeof updateMixChainDisplay==='function' && window.state && state.vocalAnalysis) updateMixChainDisplay(); }catch(_){}
  try{ if(typeof markMixConfigChanged==='function') markMixConfigChanged('mix'); }catch(_){}

  var status=document.getElementById('uploadStatus');
  if(status){ status.textContent='標準設定に戻しました'; status.className='status-line'; }
  return false;
};
