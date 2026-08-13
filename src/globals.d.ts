// Ambient declarations for browser globals not in standard lib

interface Window {
  JSZip: any;
  google: any;
  __PENDING_GDRIVE_TOKEN__: string | null;
  __PENDING_GDRIVE_ACTION__: string | null;
  __PENDING_GDRIVE_CODE__: string | null;
  __PENDING_GDRIVE_VERIFIER__: string | null;
  __PENDING_GDRIVE_REDIRECT__: string | null;
}

interface Navigator {
  standalone?: boolean;
}

declare var google: any;
declare var JSZip: any;
