/**
 * Keyboard Shortcuts für DBZS Codee
 */

export interface Shortcut {
  keys: string;
  action: string;
  description: string;
  category: 'global' | 'editor' | 'jobs' | 'runtime' | 'git';
}

export const SHORTCUTS: Shortcut[] = [
  // Global
  { keys: 'Ctrl+K', action: 'commandPalette', description: 'Command Palette öffnen', category: 'global' },
  { keys: 'Ctrl+O', action: 'openFile', description: 'Datei öffnen', category: 'global' },
  { keys: 'Ctrl+N', action: 'newFile', description: 'Neue Datei', category: 'global' },
  { keys: 'Ctrl+Shift+N', action: 'newProject', description: 'Neues Projekt', category: 'global' },
  { keys: 'Ctrl+Shift+O', action: 'openProject', description: 'Projekt öffnen', category: 'global' },
  { keys: 'Ctrl+S', action: 'saveFile', description: 'Datei speichern', category: 'global' },
  { keys: 'Ctrl+Shift+S', action: 'saveFileAs', description: 'Speichern unter', category: 'global' },
  { keys: 'Ctrl+Alt+L', action: 'cycleLayoutPreset', description: 'Layout-Fokusmodus wechseln', category: 'global' },
  { keys: ',', action: 'openSettings', description: 'Settings öffnen', category: 'global' },
  { keys: 'Escape', action: 'closePanel', description: 'Panel schließen', category: 'global' },
  
  // Jobs
  { keys: 'Ctrl+J', action: 'focusJobMonitor', description: 'Job Monitor fokussieren', category: 'jobs' },
  { keys: 'Ctrl+Shift+J', action: 'newJob', description: 'Neuen Job erstellen', category: 'jobs' },
  { keys: 'Ctrl+Shift+K', action: 'deleteJob', description: 'Job löschen', category: 'jobs' },
  { keys: 'Ctrl+Shift+R', action: 'requeueJob', description: 'Job requeuen', category: 'jobs' },
  
  // Runtime
  { keys: 'Ctrl+Shift+R', action: 'focusRuntimeChat', description: 'Runtime-Chat abspalten', category: 'runtime' },
  { keys: 'Ctrl+Shift+R', action: 'reloadBackend', description: 'Backend neu laden', category: 'runtime' },
  { keys: 'Ctrl+Shift+M', action: 'toggleRuntime', description: 'Runtime starten/stoppen', category: 'runtime' },
  
  // Editor
  { keys: 'Ctrl+F', action: 'findInFile', description: 'Suchen', category: 'editor' },
  { keys: 'Ctrl+H', action: 'replaceInFile', description: 'Ersetzen', category: 'editor' },
  { keys: 'Ctrl+G', action: 'gotoLine', description: 'Zu Zeile springen', category: 'editor' },
  
  // Git
  { keys: 'Ctrl+Shift+G', action: 'focusGitPanel', description: 'Git Panel fokussieren', category: 'git' },
  { keys: 'Ctrl+Shift+C', action: 'commitChanges', description: 'Commit erstellen', category: 'git' },
];

export function registerShortcuts() {
  document.addEventListener('keydown', (event) => {
    const shortcut = SHORTCUTS.find(s => {
      const shortcutKeys = s.keys.toLowerCase().split('+');
      const eventKeys: string[] = [];
      
      if (event.ctrlKey) eventKeys.push('ctrl');
      if (event.shiftKey) eventKeys.push('shift');
      if (event.altKey) eventKeys.push('alt');
      eventKeys.push(event.key.toLowerCase());
      
      return shortcutKeys.every(k => eventKeys.includes(k)) &&
             shortcutKeys.length === eventKeys.length;
    });
    
    if (shortcut) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('dbzs:shortcut', { detail: shortcut.action }));
    }
  });
}
