(function () {
	var overlay = null;
	var img = null;

	function ensureOverlay() {
		if (overlay) return overlay;
		overlay = document.createElement('div');
		overlay.className = 'tracktoolbox-demo-gif-overlay is-hidden';
		overlay.hidden = true;
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-label', 'Demo');

		var frame = document.createElement('div');
		frame.className = 'tracktoolbox-demo-gif-frame';

		var closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'tracktoolbox-demo-gif-close';
		closeBtn.setAttribute('aria-label', 'Close');
		closeBtn.innerHTML = '<span>&times;</span>';
		closeBtn.addEventListener('click', closeDemo);

		img = document.createElement('img');
		img.alt = 'Demo';

		frame.appendChild(closeBtn);
		frame.appendChild(img);
		overlay.appendChild(frame);
		overlay.addEventListener('click', function (e) {
			if (e.target === overlay) closeDemo();
		});
		document.body.appendChild(overlay);
		return overlay;
	}

	function openDemo(href, label) {
		ensureOverlay();
		img.alt = label ? ('Demo — ' + label) : 'Demo';
		img.removeAttribute('src');
		img.src = href;
		overlay.hidden = false;
		overlay.classList.remove('is-hidden');
		overlay.setAttribute('aria-hidden', 'false');
	}

	function closeDemo() {
		if (!overlay || overlay.hidden) return;
		overlay.hidden = true;
		overlay.classList.add('is-hidden');
		overlay.setAttribute('aria-hidden', 'true');
		if (img) img.removeAttribute('src');
	}

	document.addEventListener('click', function (e) {
		var a = e.target.closest('a.tracktoolbox-demo-gif');
		if (!a) return;
		e.preventDefault();
		openDemo(a.getAttribute('href'), (a.textContent || '').trim());
	});

	document.addEventListener('keydown', function (e) {
		if (e.key !== 'Escape') return;
		if (!overlay || overlay.hidden) return;
		e.preventDefault();
		e.stopPropagation();
		closeDemo();
	}, true);

	if (window.parent === window) return;

	document.documentElement.classList.add('is-docs-embedded');

	var links = document.querySelectorAll('a[href="../"], a[href="../index.html"]');
	for (var i = 0; i < links.length; i++) {
		var a = links[i];
		var row = a.parentNode;
		if (
			row &&
			row.parentNode &&
			(a.classList.contains('tracktoolbox-docs-cta') || a.textContent === 'Open app')
		) {
			row.parentNode.removeChild(row);
			continue;
		}
		if (a.parentNode) {
			a.parentNode.replaceChild(document.createTextNode(a.textContent), a);
		}
	}
})();
