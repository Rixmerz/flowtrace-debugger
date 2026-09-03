/**
 * Page bootstrap. Lives in its own file (rather than inline in index.html) so
 * the server can send a Content-Security-Policy of script-src 'self'.
 *
 * Auto-loads an analysis when ?analysis=<id> is in the URL — which is how
 * `flowtrace analyze` opens the browser on a result it already computed.
 */
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const analysisId = params.get('analysis');
  if (!analysisId) return;

  // Analysis ids are server-minted (`analysis-<ts>-<hex>`); anything else is
  // not worth a round trip.
  if (!/^[A-Za-z0-9_-]+$/.test(analysisId)) {
    console.error('Ignoring malformed analysis id in URL');
    return;
  }

  const apiClient = new APIClient();
  apiClient.getAnalysis(analysisId)
    .then((analysis) => {
      window.dashboard.handleAnalysisResults(analysis);
    })
    .catch((error) => {
      console.error('Failed to load analysis:', error);
    });
});
