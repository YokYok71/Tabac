import React from "react";
import { useAppCtx } from "../AppContext.tsx";

var useRef = React.useRef,
  useEffect = React.useEffect;

// "unsaved changes" guard for the edit forms. While an edit
// form is active, it registers { isDirty, onSave, onDiscard } into the App-level
// `formGuardRef` (via ctx.setFormGuard). System-back / edge-swipe (goBack) then
// checks the guard: if the form was modified, it opens a confirm modal
// (Enregistrer / Quitter sans enregistrer / Annuler) instead of leaving.
//
// Dirty detection = compare a JSON snapshot of the working-copy `form`, taken
// when the form becomes active, to the current `form`. Scoped to EDIT forms
// (not add) so a mount-time prefill on a NEW entity can't read as "dirty", and
// because the request was specifically about editing an existing object.
//
// The guard object reads the LATEST form / handlers through refs, so it stays
// correct without re-registering on every keystroke; the effect keys only on
// `active` (register on enter, clear on leave / unmount).
export function useUnsavedFormGuard(
  active: boolean,
  form: any,
  onSave: () => void,
  onDiscard: () => void,
): void {
  var ctx = useAppCtx();
  var setFormGuard = ctx.setFormGuard;
  var formRef = useRef(form);
  var saveRef = useRef(onSave);
  var discardRef = useRef(onDiscard);
  var setGuardRef = useRef(setFormGuard);
  var initialRef = useRef<string | null>(null);

  // Keep the "latest" refs current AFTER each render (writing refs during
  // render is disallowed by react-hooks/refs). isDirty / onSave / onDiscard
  // are only read later, from the goBack event, so an effect update is fine.
  useEffect(function () {
    formRef.current = form;
    saveRef.current = onSave;
    discardRef.current = onDiscard;
    setGuardRef.current = setFormGuard;
  });

  useEffect(function () {
    var sg = setGuardRef.current;
    if (!active) {
      initialRef.current = null;
      return;
    }
    try { initialRef.current = JSON.stringify(formRef.current); }
    catch (_e) { initialRef.current = ""; }
    if (sg) {
      sg({
        isDirty: function () {
          if (initialRef.current === null) return false;
          try { return JSON.stringify(formRef.current) !== initialRef.current; }
          catch (_e) { return false; }
        },
        onSave: function () { if (saveRef.current) saveRef.current(); },
        onDiscard: function () { if (discardRef.current) discardRef.current(); },
      });
    }
    return function () { if (sg) sg(null); };
  }, [active]);
}
