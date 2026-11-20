(function () {
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
