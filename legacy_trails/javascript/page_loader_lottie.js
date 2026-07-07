(function () {
	var t0 = performance.now();
	var minShowMs = 1600;
	var flags = { load: false, map: false, lottie: false };
	var finished = false;
	var el = document.getElementById('lottie-loader');
	if (el && typeof lottie !== 'undefined') {
		var anim = lottie.loadAnimation({
			container: el,
			renderer: 'svg',
			loop: true,
			autoplay: true,
			path: encodeURI('./data/Loading Circle With Dots.json')
		});
		window._pageLoaderLottie = anim;
		function lottieDone() {
			flags.lottie = true;
			tryFinish();
		}
		anim.addEventListener('data_ready', lottieDone);
		anim.addEventListener('data_failed', lottieDone);
	} else {
		flags.lottie = true;
	}
	function finish() {
		if (finished) return;
		finished = true;
		var wait = Math.max(0, minShowMs - (performance.now() - t0));
		setTimeout(function () {
			if (window._pageLoaderLottie) {
				window._pageLoaderLottie.destroy();
				window._pageLoaderLottie = null;
			}
			document.documentElement.classList.add('dom-ready');
			var l = document.getElementById('page-loader');
			if (l) l.setAttribute('aria-busy', 'false');
		}, wait);
	}
	function tryFinish() {
		if (flags.load && flags.map && flags.lottie) finish();
	}
	window.addEventListener('load', function () { flags.load = true; tryFinish(); });
	window.addEventListener('legacytrails:mapready', function () { flags.map = true; tryFinish(); });
	setTimeout(function () {
		if (!finished) {
			flags.load = flags.map = true;
			finish();
		}
	}, 12000);
})();
