    const fmt = n => (n || 0).toLocaleString('es-AR');
    const MIN_RATIO_SAMPLE = 10;
    let currentData = null;
    let currentMetrics = null;
    let currentTweetUrl = '';
    let isLoading = false;

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

    function wrapCanvasText(context, text, maxWidth) {
      const words = String(text || '').split(/\s+/).filter(Boolean);
      const lines = [];
      let line = '';

      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (context.measureText(candidate).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }

      if (line) lines.push(line);
      return lines.length ? lines : [''];
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
      return `GENERADO EN LAESQUINA.VISUALIZANDO.AR EL ${day}/${month}/${year} A LAS ${hour12}${meridiem}`;
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

    function resetResultState() {
      document.getElementById('result').style.display = 'none';
      document.getElementById('verdict').className = 'analysis-card';
      document.getElementById('verdict-label').textContent = '';
      document.getElementById('verdict-generated').textContent = '';
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
      document.getElementById('verdict-generated').textContent = formatGeneratedStamp(new Date());

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

    function getShareText() {
      if (!currentData || !currentMetrics || !currentTweetUrl) return '';
      return `Analicé respuestas, citas, retuits y favs en laesquina.visualizando.ar y el veredicto es que la calle online ${currentMetrics.shareVerdictLabel} el siguiente tuit: ${currentTweetUrl}`;
    }

    function shareOnX() {
      const text = getShareText();
      if (!text) return;
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }

    function shareOnWhatsApp() {
      const text = getShareText();
      if (!text) return;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }

    async function copyLink() {
      if (!currentTweetUrl) return;
      try {
        await navigator.clipboard.writeText(currentTweetUrl);
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

    async function generateImage() {
      if (!currentData || !currentMetrics) return;

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;

      const width = 1400;
      const padding = 80;
      const cardWidth = width - padding * 2;
      const tweetText = currentData.text || '';
      const authorName = currentData.author?.name || '';
      const authorHandle = currentData.author?.screen_name ? `@${currentData.author.screen_name}` : '';
      const generatedText = formatGeneratedStamp(new Date());

      context.font = '400 42px "IBM Plex Sans"';
      const tweetLines = wrapCanvasText(context, tweetText, cardWidth - 100);
      const tweetHeight = Math.max(220, 150 + tweetLines.length * 56);
      const height = 1180 + Math.max(0, tweetHeight - 220);

      canvas.width = width;
      canvas.height = height;

      context.fillStyle = '#edf6fc';
      context.fillRect(0, 0, width, height);

      context.fillStyle = '#ffffff';
      context.strokeStyle = 'rgba(49, 101, 140, 0.16)';
      context.lineWidth = 2;
      roundRect(context, padding, 60, cardWidth, height - 120, 36);
      context.fill();
      context.stroke();

      context.fillStyle = '#6c8194';
      context.font = '500 24px "IBM Plex Mono"';
      context.textAlign = 'center';
      context.fillText('TWEET ORIGINAL:', width / 2, 120);

      context.fillStyle = '#ffffff';
      context.strokeStyle = 'rgba(49, 101, 140, 0.18)';
      roundRect(context, padding + 26, 150, cardWidth - 52, tweetHeight, 28);
      context.fill();
      context.stroke();

      const tweetLeft = padding + 70;
      let y = 220;

      context.fillStyle = '#274c69';
      context.font = '700 34px "IBM Plex Sans"';
      context.textAlign = 'left';
      context.fillText(authorName, tweetLeft, y);
      y += 42;
      context.fillStyle = '#6c8194';
      context.font = '400 26px "IBM Plex Sans"';
      context.fillText(authorHandle, tweetLeft, y);
      y += 54;

      context.fillStyle = '#274c69';
      context.font = '400 42px "IBM Plex Sans"';
      for (const line of tweetLines) {
        context.fillText(line, tweetLeft, y);
        y += 56;
      }

      const analysisTop = 150 + tweetHeight + 32;
      context.fillStyle = '#ffffff';
      context.strokeStyle = 'rgba(49, 101, 140, 0.18)';
      roundRect(context, padding + 26, analysisTop, cardWidth - 52, 360, 28);
      context.fill();
      context.stroke();

      context.fillStyle = currentMetrics.verdict === 'ratioed'
        ? '#e34c43'
        : currentMetrics.verdict === 'safe'
          ? '#4c8f63'
          : '#274c69';
      context.font = '700 84px "IBM Plex Sans"';
      context.textAlign = 'center';
      context.fillText(currentMetrics.verdictLabel.toUpperCase(), width / 2, analysisTop + 120);

      const trackLeft = padding + 80;
      const trackTop = analysisTop + 176;
      const trackWidth = cardWidth - 160;
      const gradient = context.createLinearGradient(trackLeft, 0, trackLeft + trackWidth, 0);
      gradient.addColorStop(0, '#e34c43');
      gradient.addColorStop(0.5, '#b6bec6');
      gradient.addColorStop(1, '#4c8f63');
      context.fillStyle = gradient;
      roundRect(context, trackLeft, trackTop, trackWidth, 12, 999);
      context.fill();

      const markerX = trackLeft + (trackWidth * currentMetrics.markerPct / 100);
      context.fillStyle = currentMetrics.verdict === 'ratioed'
        ? '#e34c43'
        : currentMetrics.verdict === 'safe'
          ? '#4c8f63'
          : '#b69757';
      context.beginPath();
      context.arc(markerX, trackTop + 6, 18, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#ffffff';
      context.lineWidth = 4;
      context.stroke();

      context.fillStyle = '#274c69';
      context.font = '700 22px "IBM Plex Mono"';
      context.textAlign = 'left';
      context.fillText('LO PUTEAN', trackLeft, trackTop - 18);
      context.textAlign = 'right';
      context.fillText('LO BANCAN', trackLeft + trackWidth, trackTop - 18);

      const metricTop = analysisTop + 230;
      const metricWidth = (trackWidth - 36) / 4;
      const metrics = [
        { label: 'COMMENTS', value: fmt(currentMetrics.replies), good: false },
        { label: 'QUOTE TWEETS', value: fmt(currentMetrics.quotes), good: false },
        { label: 'FAVS', value: fmt(currentMetrics.likes), good: currentMetrics.verdict === 'safe' },
        { label: 'RETUITS', value: fmt(currentMetrics.rt), good: currentMetrics.verdict === 'safe' },
      ];

      metrics.forEach((metric, index) => {
        const metricLeft = trackLeft + index * (metricWidth + 12);
        context.fillStyle = 'rgba(255,255,255,0.9)';
        roundRect(context, metricLeft, metricTop, metricWidth, 84, 18);
        context.fill();
        context.fillStyle = '#6c8194';
        context.font = '500 18px "IBM Plex Mono"';
        context.textAlign = 'center';
        context.fillText(metric.label, metricLeft + metricWidth / 2, metricTop + 28);
        context.fillStyle = metric.good ? '#4c8f63' : '#274c69';
        context.font = '500 34px "IBM Plex Sans"';
        context.fillText(metric.value, metricLeft + metricWidth / 2, metricTop + 64);
      });

      context.fillStyle = 'rgba(47, 103, 143, 0.52)';
      context.font = '500 18px "IBM Plex Mono"';
      context.textAlign = 'center';
      context.fillText(generatedText, width / 2, analysisTop + 340);

      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = 'la-esquina-online.png';
      link.click();
    }

    function roundRect(context, x, y, width, height, radius) {
      context.beginPath();
      context.moveTo(x + radius, y);
      context.lineTo(x + width - radius, y);
      context.arcTo(x + width, y, x + width, y + radius, radius);
      context.lineTo(x + width, y + height - radius);
      context.arcTo(x + width, y + height, x + width - radius, y + height, radius);
      context.lineTo(x + radius, y + height);
      context.arcTo(x, y + height, x, y + height - radius, radius);
      context.lineTo(x, y + radius);
      context.arcTo(x, y, x + radius, y, radius);
      context.closePath();
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
