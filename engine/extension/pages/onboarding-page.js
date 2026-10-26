// Histoire d'installation en pleine fenêtre (onboarding.js de la version Electron).
(async () => {
  const api = window.pouley;
  const snap = await api.getState();
  window.PouleyOnboarding.start(document.getElementById('onboarding'), {
    settings: snap.state.settings,
    cometAvailable: false,
    onDone: async (choices) => {
      await api.cmd('onboarding.done', choices);
      location.href = 'newtab.html';
    },
  });
})();
