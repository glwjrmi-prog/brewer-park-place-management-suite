// Staging compatibility patch for Google Drive Picker setup inside native <dialog>.
// The legacy setup overlay is a normal fixed element; a native <dialog> sits in
// the browser top layer and can hide that overlay. Temporarily close the editor
// while setup is visible, then restore it after setup closes.
(function(){
  'use strict';

  if(typeof drivePickerOpenSetup!=='function' || typeof drivePickerRemoveSetup!=='function') return;

  const originalOpenSetup=drivePickerOpenSetup;
  const originalRemoveSetup=drivePickerRemoveSetup;
  let openingSetup=false;

  drivePickerRemoveSetup=function(){
    originalRemoveSetup();
    if(!openingSetup && typeof drivePickerRestoreRecordDialog==='function'){
      drivePickerRestoreRecordDialog();
    }
  };

  drivePickerOpenSetup=function(message=''){
    if(typeof drivePickerHideRecordDialog==='function') drivePickerHideRecordDialog();
    openingSetup=true;
    try{
      originalOpenSetup(message);
    }finally{
      openingSetup=false;
    }
  };
})();
