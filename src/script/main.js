// Main JS for phone mask, validation, webhook submission, and success UI
(function () {
    // --- Background carousel: automatic slides with minimal footprint ---
    (function setupBackgroundCarousel() {
        try {
            var carouselRoot = document.querySelector('.form-section .bg');
            if (!carouselRoot) return;

            var slides = Array.from(carouselRoot.querySelectorAll('.bg-slide'));
            if (!slides.length) return;

            var current = slides.findIndex(function (s) { return s.classList.contains('active'); });
            if (current < 0) current = 0;

            var interval = 2000; // ms between slides
            var timer = null;

            function show(index) {
                slides.forEach(function (s, i) {
                    s.classList.toggle('active', i === index);
                });
                current = index;
            }

            function next() {
                var nextIndex = (current + 1) % slides.length;
                show(nextIndex);
            }

            function start() {
                stop();
                timer = setInterval(next, interval);
            }

            function stop() {
                if (timer) {
                    clearInterval(timer);
                    timer = null;
                }
            }

            // Pause on hover / focus for accessibility
            carouselRoot.addEventListener('mouseenter', stop);
            carouselRoot.addEventListener('mouseleave', start);
            carouselRoot.addEventListener('touchstart', stop, { passive: true });
            carouselRoot.addEventListener('touchend', start, { passive: true });

            // kick off
            show(current);
            start();
        } catch (e) {
            console.error('Carousel init error', e);
        }
    })();
    const form = document.getElementById('whatsapp-form');
    const phoneInput = document.getElementById('phone');
    const submitBtn = document.getElementById('submit-btn');
    const btnText = submitBtn?.querySelector('.btn-text');
    const messageEl = document.getElementById('form-message');
    const whatsappIcon = document.getElementById('whatsapp-icon');
    const popup = document.getElementById('form-popup');
    const popupTitle = popup?.querySelector('.popup-title');
    const popupMsg = popup?.querySelector('.popup-message');
    const popupLink = document.getElementById('popup-link');
    const popupImg = document.querySelector('.popup-illustration');
    const loadingOverlay = document.getElementById('loading-overlay');

    if (!form || !phoneInput || !submitBtn) return;

    // CONFIG: set your webhook URL here or via data-webhook on form
    const WEBHOOK_URL = form.getAttribute('data-webhook') || '';
    const FALLBACK_URL = form.getAttribute('data-fallback-url') || '/catalogo.pdf';
    const SUCCESS_IMG = form.getAttribute('data-success-img') || '';
    const ERROR_IMG = form.getAttribute('data-error-img') || '';

    // Helpers
    const onlyDigits = (v) => (v || '').replace(/\D+/g, '');

    // Parse URL query parameters into an object
    function getQueryParams() {
        const params = {};
        try {
            var search = window.location.search || '';
            if (!search) return params;
            var usp = new URLSearchParams(search);
            usp.forEach(function (value, key) {
                params[key] = value;
            });
        } catch (e) {
            // ignore
        }
        return params;
    }

    // Extract common UTM and campaign identifiers from query params
    function extractUTMs(allParams) {
        var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
        var out = {};
        keys.forEach(function (k) {
            if (allParams[k]) out[k] = allParams[k];
        });
        return out;
    }

    // Brazil phone mask: +55 (DD) 9XXXX-XXXX or XXXX-XXXX depending on length
    function formatBrazilPhone(input) {
        let v = onlyDigits(input);

        // ensure it starts with country code 55; user types from DDD
        if (!v.startsWith('55')) {
            v = '55' + v;
        }

        // Keep max 13 or 14 digits with 55 + 2 DDD + 8/9 digits
        v = v.slice(0, 13 + 0); // 55 + 2 + 9 = 13 digits max for mobile

        const cc = '+55';
        const rest = v.slice(2); // after 55
        const ddd = rest.slice(0, 2);
        const number = rest.slice(2);

        let formatted = cc;
        if (ddd.length) {
            formatted += ` (${ddd}`;
            if (ddd.length === 2) formatted += ')';
        }

        if (number.length > 0) {
            // Mobile usually 9 digits (e.g., 9 9999-9999). Landline 8 digits.
            if (number.length <= 5) {
                // Up to "9 9999"
                formatted += ` ${number}`;
            } else if (number.length <= 9) {
                // split: first part length = number.length - 4
                const first = number.slice(0, number.length - 4);
                const last = number.slice(-4);
                formatted += ` ${first}-${last}`;
            } else {
                const first = number.slice(0, 5);
                const mid = number.slice(5, 9);
                const last = number.slice(9, 13);
                formatted += ` ${first}${mid ? '-' + mid : ''}${last ? '-' + last : ''}`;
            }
        }

        return formatted;
    }

    function getE164(input) {
        // return +55XXXXXXXXXXX or null if invalid
        const digits = onlyDigits(input);
        // Expect 55 + DDD(2) + 9 digits (mobile) or 8 (landline)
        if (!digits.startsWith('55')) return null;
        const local = digits.slice(2);
        if (local.length === 11 || local.length === 10) {
            return '+' + digits.slice(0, 2) + local; // +55xxxxxxxxxxx
        }
        return null;
    }

    function validatePhone(input) {
        const digits = onlyDigits(input);
        if (!digits.startsWith('55')) return false;
        const ddd = digits.slice(2, 4);
        const local = digits.slice(4);

        // Basic DDD check: must be 2 digits and not starting with 0
        if (ddd.length !== 2 || ddd.startsWith('0')) return false;

        // Accept only mobile (9 digits, starting with 9) for WhatsApp
        return local.length === 9 && local.startsWith('9');
    }

    function toggleButtonState(valid) {
        if (valid) {
            submitBtn.removeAttribute('disabled');
            submitBtn.removeAttribute('aria-disabled');
        } else {
            submitBtn.setAttribute('disabled', '');
            submitBtn.setAttribute('aria-disabled', 'true');
        }
    }

    // Initialize with +55 in the input and caret after it
    function ensurePrefix() {
        const val = phoneInput.value;
        if (!val || !val.startsWith('+55')) {
            phoneInput.value = '+55 ';
        }
    }

    ensurePrefix();

    // Mask on input
    phoneInput.addEventListener('input', (e) => {
        const caretEnd = phoneInput.selectionEnd || phoneInput.value.length;
        const before = phoneInput.value;
        const masked = formatBrazilPhone(phoneInput.value);
        phoneInput.value = masked;

        // keep caret towards the end; for simplicity, set to end
        phoneInput.setSelectionRange(phoneInput.value.length, phoneInput.value.length);

        toggleButtonState(validatePhone(masked));
    });

    phoneInput.addEventListener('focus', () => {
        ensurePrefix();
        // place caret at the end so user starts after prefix
        const len = phoneInput.value.length;
        phoneInput.setSelectionRange(len, len);
    });

    // Prevent deleting the +55 part
    phoneInput.addEventListener('keydown', (e) => {
        const start = phoneInput.selectionStart || 0;
        const end = phoneInput.selectionEnd || 0;
        const prefix = '+55';
        if ((e.key === 'Backspace' && start <= prefix.length) || (e.key === 'Delete' && start < prefix.length + 1)) {
            e.preventDefault();
            // keep '+55 '
            ensurePrefix();
            phoneInput.setSelectionRange(phoneInput.value.length, phoneInput.value.length);
            return;
        }
    });

    function showMessage(html, type) {
        if (!messageEl) return;
        messageEl.hidden = false;
        messageEl.className = `form-message ${type || ''}`;
        messageEl.innerHTML = html;
    }

    function openPopup({ title, message, linkHref, linkText, mode }) {
        if (!popup) return;
        popupTitle && (popupTitle.textContent = title || '');
        popupMsg && (popupMsg.textContent = message || '');
        if (popupLink) {
            popupLink.href = linkHref || '#';
            popupLink.textContent = linkText || 'Acessar';
        }
        if (popupImg) {
            const src = mode === 'success' ? SUCCESS_IMG : ERROR_IMG;
            if (src) {
                popupImg.src = src;
                popupImg.hidden = false;
            } else {
                popupImg.hidden = true;
            }
        }
        popup.hidden = false;
    }

    function closePopup() {
        if (!popup) return;
        popup.hidden = true;
    }

    popup?.addEventListener('click', (e) => {
        const target = e.target;
        if (target && (target.hasAttribute('data-close') || target.classList.contains('popup-backdrop'))) {
            closePopup();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePopup();
    });

    function setSubmitting(isSubmitting) {
        // button spinner removed; we use overlay
        if (isSubmitting) {
            submitBtn.setAttribute('disabled', '');
            submitBtn.setAttribute('aria-disabled', 'true');
            showLoadingOverlay();
        } else {
            toggleButtonState(validatePhone(phoneInput.value));
            hideLoadingOverlay();
        }
    }

    function showLoadingOverlay() {
        if (!loadingOverlay) return;
        loadingOverlay.hidden = false;
    }

    function hideLoadingOverlay() {
        if (!loadingOverlay) return;
        loadingOverlay.hidden = true;
    }

    function swapIconToCheck() {
        if (!whatsappIcon) return;
        // Replace path with a check icon
        whatsappIcon.setAttribute('viewBox', '0 0 24 24');
        whatsappIcon.innerHTML = '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />';
    }

    async function sendWebhook(payload) {
        if (!WEBHOOK_URL) throw new Error('Webhook não configurado. Defina data-webhook no <form>.');
        const res = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Erro ao enviar: ${res.status} ${text}`);
        }
        return res.json().catch(() => ({}));
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const valid = validatePhone(phoneInput.value);
        if (!valid) {
            toggleButtonState(false);
            phoneInput.focus();
            return;
        }

        const e164 = getE164(phoneInput.value);
        if (!e164) {
            toggleButtonState(false);
            phoneInput.focus();
            return;
        }

        setSubmitting(true);
        let sent = false;
        const minDelay = new Promise((resolve) => setTimeout(resolve, 1000)); // 1s min loading

        try {
            var queryParams = getQueryParams();
            var utms = extractUTMs(queryParams);

            const payload = {
                phone: e164,
                raw: phoneInput.value,
                source: 'lp-events-fasthomes',
                timestamp: new Date().toISOString(),
                page_url: window.location.href,
                page_referrer: document.referrer || null,
                query_params: queryParams,
                utm: utms,
            };
            const resultPromise = sendWebhook(payload);
            await Promise.all([resultPromise, minDelay]);

            swapIconToCheck();
            if (btnText) btnText.textContent = 'Enviado com sucesso';
            submitBtn.classList.add('btn-success');

            const waLink = `https://wa.me/${onlyDigits(e164)}?text=${encodeURIComponent('Olá! Quero receber o catálogo.')}`;
            openPopup({
                title: 'Enviado com sucesso',
                message: 'Nós da Equipe da Fast Homes agradecemos o seu contato!',
                linkHref: FALLBACK_URL,
                linkText: 'Abrir catálogo no site',
                mode: 'success',
            });

            // Optional: disable the form after success
            submitBtn.setAttribute('disabled', '');
            submitBtn.setAttribute('aria-disabled', 'true');
            sent = true;
        } catch (err) {
            console.error(err);
            await minDelay;
            openPopup({
                title: 'Erro ao enviar o Catálogo',
                message: 'Descrição do erro e como resolver. Caso não seja possível corrigir agora, você pode <a href="' + FALLBACK_URL + '" target="_blank" rel="noopener">acessar o catálogo direto</a>.',
                linkHref: FALLBACK_URL,
                linkText: 'Abrir catálogo no site',
                mode: 'error',
            });
        } finally {
            if (!sent) setSubmitting(false);
        }
    });
})();
