    const fmt = n => (n || 0).toLocaleString('es-AR');
    const MIN_RATIO_SAMPLE = 10;
    let currentData = null;
    let currentMetrics = null;
    let currentTweetUrl = '';
    let isLoading = false;

    function buildAppUrl(tweetUrl) {
      const nextUrl = new URL(window.location.href);
      if (tweetUrl) {
        nextUrl.searchParams.set('url', tweetUrl);
      } else {
        nextUrl.searchParams.delete('url');
      }
      return nextUrl.toString();
    }

    function syncAppUrl(tweetUrl) {
      window.history.replaceState({}, '', buildAppUrl(tweetUrl));
    }

    function loadTweetFromQuery() {
      const initialUrl = new URL(window.location.href).searchParams.get('url');
      if (!initialUrl) return;

      const input = document.getElementById('tweet-url');
      input.value = initialUrl.trim();
      updateClearButtonVisibility();
      analyze();
    }

    function parseTweetUrl(url) {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '').replace(/^mobile\./, '');
        if (host !== 'twitter.com' && host !== 'x.com') return null;

        const parts = parsed.pathname.split('/').filter(Boolean);
        const statusIndex = parts.indexOf('status');
        if (statusIndex < 1) return null;

        const username = parts[statusIndex - 1];
        const id = parts[statusIndex + 1];
        if (!/^[A-Za-z0-9_]{1,15}$/.test(username) || !/^\d+$/.test(id || '')) return null;

        return { username, id };
      } catch {
        return null;
      }
    }

    function normalizeCount(value) {
      const count = Number(value);
      return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
    }

    function computeRatioMetrics(tweet) {
      const rt = normalizeCount(tweet?.retweets);
      const replies = normalizeCount(tweet?.replies);
      const quotes = normalizeCount(tweet?.quotes);
      const likes = normalizeCount(tweet?.likes);
      const opposition = replies + quotes;
      const sample = rt + opposition;
      const sentimentScore = sample > 0 ? Math.round(((rt - opposition) / sample) * 100) : 0;
      const markerPct = sample > 0 ? ((sentimentScore + 100) / 2) : 50;

      if (sample === 0) {
        return {
          rt,
          replies,
          quotes,
          likes,
          opposition,
          sample,
          verdict: 'neutral',
          verdictLabel: 'Sin muestra',
          shareVerdictLabel: 'NO SE SABE',
          sentimentScore,
          markerPct,
          verified: false,
        };
      }

      if (sample < MIN_RATIO_SAMPLE) {
        return {
          rt,
          replies,
          quotes,
          likes,
          opposition,
          sample,
          verdict: 'neutral',
          verdictLabel: 'Zona gris',
          shareVerdictLabel: 'ESTA DIVIDIDA',
          sentimentScore,
          markerPct,
          verified: false,
        };
      }

      let verdict = 'neutral';
      let verdictLabel = 'Quedó dividido';
      let shareVerdictLabel = 'ESTA DIVIDIDA';

      if (sentimentScore <= -35) {
        verdict = 'ratioed';
        verdictLabel = 'Lo re bardean';
        shareVerdictLabel = 'RE BARDEA';
      } else if (sentimentScore < -10) {
        verdict = 'ratioed';
        verdictLabel = 'Lo bardean';
        shareVerdictLabel = 'BARDEA';
      } else if (sentimentScore >= 35) {
        verdict = 'safe';
        verdictLabel = 'Lo re bancan';
        shareVerdictLabel = 'RE BANCA';
      } else if (sentimentScore > 10) {
        verdict = 'safe';
        verdictLabel = 'La gente banca';
        shareVerdictLabel = 'BANCA';
      }

      return {
        rt,
        replies,
        quotes,
        likes,
        opposition,
        sample,
        verdict,
        verdictLabel,
        shareVerdictLabel,
        sentimentScore,
        markerPct,
        verified: Boolean(tweet?.author?.verified || tweet?.author?.blue_verified || tweet?.author?.is_blue_verified),
      };
    }

    function setError(message) {
      const el = document.getElementById('err-msg');
      el.textContent = message;
      el.style.display = message ? 'block' : 'none';
    }

    function formatGeneratedStamp(date) {
      const safeDate = date instanceof Date ? date : new Date();
      const day = String(safeDate.getDate()).padStart(2, '0');
      const month = String(safeDate.getMonth() + 1).padStart(2, '0');
      const year = safeDate.getFullYear();
      const hour24 = safeDate.getHours();
      const hour12 = hour24 % 12 || 12;
      const meridiem = hour24 >= 12 ? 'PM' : 'AM';
      return `GENERADO EN <strong>LAESQUINA.VISUALIZANDO.AR</strong> EL ${day}/${month}/${year} A LAS ${hour12}${meridiem}`;
    }

    function setHeroVisibility(show) {
      document.body.classList.toggle('hero-hidden', !show);
    }

    function setLoading(on) {
      const btn = document.getElementById('analyze-btn');
      const spinner = document.getElementById('spinner');
      isLoading = on;
      btn.disabled = on;
      spinner.style.display = on ? 'inline-block' : 'none';
      btn.lastChild.textContent = on ? 'Analizando' : 'Analizar';
    }

    function updateClearButtonVisibility() {
      const clearButton = document.getElementById('clear-search-btn');
      const input = document.getElementById('tweet-url');
      clearButton.classList.toggle('is-visible', Boolean(input.value.trim()));
    }

    function resetResultState() {
      document.getElementById('result').style.display = 'none';
      document.getElementById('verdict').className = 'analysis-card';
      document.getElementById('verdict-label').textContent = '';
      document.getElementById('verdict-generated').innerHTML = '';
      document.getElementById('author-name').textContent = '';
      document.getElementById('author-handle').textContent = '';
      document.getElementById('author-badge').style.display = 'none';
      document.getElementById('tweet-text').textContent = '';
      document.getElementById('tweet-date').textContent = '';
      document.getElementById('avatar-initials').textContent = '';
      document.getElementById('avatar-initials').style.display = 'inline';
      document.getElementById('tweet-replies-inline').textContent = '0';
      document.getElementById('tweet-retweets-inline').textContent = '0';
      document.getElementById('tweet-quotes-inline').textContent = '0';
      document.getElementById('tweet-likes-inline').textContent = '0';

      const avatarImg = document.getElementById('avatar-img');
      avatarImg.removeAttribute('src');
      avatarImg.alt = '';
      avatarImg.style.display = 'none';
      avatarImg.onerror = null;

      document.getElementById('v-rep').textContent = '0';
      document.getElementById('v-qt').textContent = '0';
      document.getElementById('v-lk').textContent = '0';
      document.getElementById('v-rt').textContent = '0';

      ['m-rep', 'm-qt', 'm-lk', 'm-rt'].forEach(id => {
        document.getElementById(id).className = 'metric-card';
      });
      const marker = document.getElementById('axis-marker');
      marker.style.left = '50%';
      marker.style.background = 'var(--amber)';
    }

    function clearTweetInput() {
      if (isLoading) return;

      currentData = null;
      currentMetrics = null;
      currentTweetUrl = '';

      const input = document.getElementById('tweet-url');
      input.value = '';

      setError('');
      resetResultState();
      setHeroVisibility(true);
      syncAppUrl('');
      updateClearButtonVisibility();
      input.focus();
    }

    async function fetchTweet(username, id) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      try {
        const res = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(username)}/status/${id}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data || typeof data !== 'object' || !data.tweet) {
          throw new Error('No se encontró el tuit');
        }

        return data.tweet;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('timeout');
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    async function analyze() {
      if (isLoading) return;

      const url = document.getElementById('tweet-url').value.trim();
      currentData = null;
      currentMetrics = null;
      currentTweetUrl = '';

      setError('');
      resetResultState();

      const parsed = parseTweetUrl(url);
      if (!parsed) {
        setError('URL no reconocida. Formato esperado: x.com/usuario/status/12345…');
        setHeroVisibility(true);
        return;
      }

      setHeroVisibility(false);
      setLoading(true);
      try {
        const tweet = await fetchTweet(parsed.username, parsed.id);
        currentData = tweet;
        currentTweetUrl = `https://x.com/${parsed.username}/status/${parsed.id}`;
        syncAppUrl(currentTweetUrl);
        renderResult(tweet);
      } catch (error) {
        const message = error && error.message === 'timeout'
          ? 'La consulta tardó demasiado. Probá de nuevo en unos segundos.'
          : `No se pudo obtener el tuit. Verificá que sea público. (${error.message})`;
        setError(message);
        setHeroVisibility(true);
      } finally {
        setLoading(false);
      }
    }

    function renderResult(tweet) {
      resetResultState();

      const metrics = computeRatioMetrics(tweet);
      currentMetrics = metrics;

      document.getElementById('verdict').classList.add(`is-${metrics.verdict}`);
      document.getElementById('verdict-label').textContent = metrics.verdictLabel;
      document.getElementById('verdict-generated').innerHTML = formatGeneratedStamp(new Date());

      const initials = document.getElementById('avatar-initials');
      const avatarImg = document.getElementById('avatar-img');
      const badge = document.getElementById('author-badge');

      if (tweet.author) {
        document.getElementById('author-name').textContent = tweet.author.name || '';
        document.getElementById('author-handle').textContent = tweet.author.screen_name ? `@${tweet.author.screen_name}` : '';
        initials.textContent = (tweet.author.name || '?').charAt(0).toUpperCase();
        badge.style.display = metrics.verified ? 'inline-flex' : 'none';

        if (tweet.author.avatar_url) {
          avatarImg.onerror = () => {
            avatarImg.style.display = 'none';
            initials.style.display = 'inline';
          };
          avatarImg.src = tweet.author.avatar_url;
          avatarImg.alt = tweet.author.name || 'Avatar';
          avatarImg.style.display = 'block';
          initials.style.display = 'none';
        }
      } else {
        initials.textContent = '?';
      }

      document.getElementById('tweet-text').textContent = tweet.text || '';

      if (tweet.created_at) {
        const date = new Date(tweet.created_at);
        document.getElementById('tweet-date').textContent =
          `${date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })} · ${date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
      }

      document.getElementById('tweet-replies-inline').textContent = fmt(metrics.replies);
      document.getElementById('tweet-retweets-inline').textContent = fmt(metrics.rt);
      document.getElementById('tweet-quotes-inline').textContent = fmt(metrics.quotes);
      document.getElementById('tweet-likes-inline').textContent = fmt(metrics.likes);

      document.getElementById('v-rep').textContent = fmt(metrics.replies);
      document.getElementById('v-qt').textContent = fmt(metrics.quotes);
      document.getElementById('v-lk').textContent = fmt(metrics.likes);
      document.getElementById('v-rt').textContent = fmt(metrics.rt);

      if (metrics.verdict === 'ratioed') {
        document.getElementById('m-rep').classList.add('is-bad');
        document.getElementById('m-qt').classList.add('is-bad');
      }

      if (metrics.verdict === 'safe') {
        document.getElementById('m-lk').classList.add('is-good');
        document.getElementById('m-rt').classList.add('is-good');
      }

      const marker = document.getElementById('axis-marker');
      marker.style.left = `${metrics.markerPct.toFixed(1)}%`;
      marker.style.background = metrics.verdict === 'ratioed'
        ? 'var(--red)'
        : metrics.verdict === 'safe'
          ? 'var(--green)'
          : 'var(--amber)';

      setHeroVisibility(false);
      document.getElementById('result').style.display = 'block';
    }

    function getShareText(shareUrl = currentTweetUrl) {
      if (!currentData || !currentMetrics || !currentTweetUrl) return '';
      return `Analice respuestas, citas, retuits y favs en laesquina.visualizando.ar. Veredicto: la calle online ${currentMetrics.shareVerdictLabel} este tuit. Miralo aca: ${shareUrl}`;
    }

    function getXShareText() {
      if (!currentData || !currentMetrics || !currentTweetUrl) return '';

      const MAX_X_POST_LENGTH = 256;
      const candidates = [
        `Analizando las respuestas, citas, retuits y favs en laesquina.visualizando.ar el veredicto es que la calle online ${currentMetrics.shareVerdictLabel} este tuit:`,
        `Analizando respuestas, citas, retuits y favs en laesquina.visualizando.ar el veredicto es que la calle online ${currentMetrics.shareVerdictLabel} este tuit:`,
        `En laesquina.visualizando.ar el veredicto es que la calle online ${currentMetrics.shareVerdictLabel} este tuit:`,
        `La calle online ${currentMetrics.shareVerdictLabel} este tuit:`,
      ];

      return candidates.find(candidate => candidate.length <= MAX_X_POST_LENGTH) || candidates.at(-1);
    }

    function shareOnX() {
      const text = getXShareText();
      if (!text) return;
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(currentTweetUrl)}`, '_blank', 'noopener');
    }

    function shareOnWhatsApp() {
      const text = getShareText(buildAppUrl(currentTweetUrl));
      if (!text) return;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }

    async function copyLink() {
      if (!currentTweetUrl) return;
      try {
        await navigator.clipboard.writeText(buildAppUrl(currentTweetUrl));
        const btn = document.getElementById('copy-link-btn');
        const original = btn.textContent;
        btn.textContent = 'Copiado';
        setTimeout(() => {
          btn.textContent = original;
        }, 1800);
      } catch {
        alert('No se pudo copiar el link.');
      }
    }

    function buildExportCardClone(sourceNode) {
      const wrapper = document.createElement('div');
      wrapper.style.position = 'fixed';
      wrapper.style.left = '-10000px';
      wrapper.style.top = '0';
      wrapper.style.padding = '24px';
      wrapper.style.background = '#edf6fc';
      wrapper.style.zIndex = '-1';

      const clone = sourceNode.cloneNode(true);
      clone.style.width = `${sourceNode.offsetWidth}px`;
      clone.style.maxWidth = `${sourceNode.offsetWidth}px`;
      clone.style.margin = '0';

      clone.querySelectorAll('[data-export-ignore="true"]').forEach(node => {
        node.remove();
      });

      clone.querySelectorAll('img').forEach(image => {
        image.remove();
      });

      clone.querySelectorAll('[id]').forEach(node => {
        node.removeAttribute('id');
      });

      const initials = clone.querySelector('.tweet-avatar span');
      if (initials) initials.style.display = 'inline';

      wrapper.appendChild(clone);
      return wrapper;
    }

    async function generateImage() {
      if (!currentData || !currentMetrics) return;
      const exportCard = document.getElementById('export-card');
      if (!exportCard || !window.htmlToImage) {
        alert('No se pudo generar la imagen.');
        return;
      }

      const generateButton = document.getElementById('generate-image-btn');
      const originalText = generateButton ? generateButton.textContent : '';
      let exportWrapper = null;

      try {
        if (generateButton) generateButton.textContent = 'Generando...';

        exportWrapper = buildExportCardClone(exportCard);
        document.body.appendChild(exportWrapper);

        const exportTarget = exportWrapper.firstElementChild;

        const dataUrl = await window.htmlToImage.toPng(exportTarget, {
          cacheBust: true,
          pixelRatio: 2,
          backgroundColor: '#edf6fc',
        });

        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = 'la-esquina-online.png';
        link.click();
      } catch (error) {
        console.error(error);
        alert('No se pudo generar la imagen.');
      } finally {
        if (exportWrapper) exportWrapper.remove();
        if (generateButton) generateButton.textContent = originalText;
      }
    }

    function setModalOpen(modalId, open) {
      const modal = document.getElementById(modalId);
      if (!modal) return;
      modal.classList.toggle('is-active', open);
      document.documentElement.classList.toggle('is-clipped', open);
    }

    document.querySelectorAll('[data-modal-target]').forEach(button => {
      button.addEventListener('click', () => {
        setModalOpen(button.dataset.modalTarget, true);
      });
    });

    document.querySelectorAll('[data-close-modal]').forEach(element => {
      element.addEventListener('click', () => {
        const modal = element.closest('.modal');
        if (modal) setModalOpen(modal.id, false);
      });
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      document.querySelectorAll('.modal.is-active').forEach(modal => {
        setModalOpen(modal.id, false);
      });
    });

    document.getElementById('tweet-url').addEventListener('keydown', event => {
      if (event.key === 'Enter') analyze();
    });

    document.getElementById('tweet-url').addEventListener('input', () => {
      updateClearButtonVisibility();
    });

    document.getElementById('clear-search-btn').addEventListener('click', () => {
      clearTweetInput();
    });

    updateClearButtonVisibility();

    loadTweetFromQuery();
