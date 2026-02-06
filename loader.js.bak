export function showLoader(minimumTime = 10) {
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        loader.classList.remove('hide');
        loader.dataset.showTime = Date.now();
        loader.dataset.minimumTime = minimumTime; 
    }
}

export function hideLoader() {
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        const showTime = parseInt(loader.dataset.showTime || '0');
        const minimumTime = parseInt(loader.dataset.minimumTime || '0');
        const elapsedTime = Date.now() - showTime;
        
        if (elapsedTime < minimumTime) {
            setTimeout(() => {
                loader.classList.add('hide');
            }, minimumTime - elapsedTime);
        } else {
            loader.classList.add('hide');
        }
    }
}