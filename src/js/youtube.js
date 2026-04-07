const YT_SCRIPT = 'https://www.youtube.com/iframe_api';

function loadIframeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (window.__ytIframeApiPromise) return window.__ytIframeApiPromise;

  window.__ytIframeApiPromise = new Promise((resolve) => {
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prior === 'function') prior();
      resolve();
    };

    const existing = document.querySelector(`script[src="${YT_SCRIPT}"]`);
    if (!existing) {
      const s = document.createElement('script');
      s.src = YT_SCRIPT;
      document.head.appendChild(s);
    }
  });

  return window.__ytIframeApiPromise;
}

/**
 * @param {{ elementId: string, playlistId: string, onReady?: (player: object) => void, onStateChange?: (event: { data: number, target: object }) => void }} opts
 */
export async function createPlaylistPlayer({ elementId, playlistId, onReady, onStateChange }) {
  await loadIframeApi();
  return new YT.Player(elementId, {
    height: '0',
    width: '0',
    playerVars: {
      listType: 'playlist',
      list: playlistId,
      autoplay: 0,
      controls: 0,
      modestbranding: 1,
      playsinline: 1,
      loop: 1,
      shuffle: 1,
    },
    events: {
      onReady: (e) => onReady?.(e.target),
      onStateChange: (e) => onStateChange?.(e),
    },
  });
}
