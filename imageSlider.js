export function initializeImageSliders() {
  const sliders = document.querySelectorAll('.product-image-container');

  sliders.forEach(slider => {
    let currentIndex = 0;
    const images = slider.querySelectorAll('.product-image');
    const imageSlider = slider.querySelector('.image-slider');
    let autoSlideInterval;
    let autoSlideTimeout;
    
    // Create dots container
    const dotsContainer = document.createElement('div');
    dotsContainer.className = 'pagination-dots';
    
    // Create dots based on number of images
    images.forEach((_, index) => {
      const dot = document.createElement('div');
      dot.className = `dot ${index === 0 ? 'active' : ''}`;
      dot.addEventListener('click', () => goToSlide(index));
      dotsContainer.appendChild(dot);
    });
    
    slider.appendChild(dotsContainer);

    // Touch handling variables
    let startX;
    let isDragging = false;

    // Touch events - using passive listeners for better scroll performance
    slider.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      isDragging = true;
      pauseAutoSlide();
    }, { passive: true });

    slider.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const currentX = e.touches[0].clientX;
      const diff = startX - currentX;
      const sliderWidth = slider.offsetWidth;
      
      if (
        (currentIndex === 0 && diff < 0) || 
        (currentIndex === images.length - 1 && diff > 0)
      ) {
        return;
      }
      
      imageSlider.style.transform = `translateX(${-currentIndex * 100 - (diff / sliderWidth) * 100}%)`;
    }, { passive: true });

    slider.addEventListener('touchend', (e) => {
      if (!isDragging) return;
      isDragging = false;
      
      const diff = startX - e.changedTouches[0].clientX;
      const threshold = slider.offsetWidth * 0.2;

      if (Math.abs(diff) > threshold) {
        if (diff > 0 && currentIndex < images.length - 1) {
          currentIndex++;
        } else if (diff < 0 && currentIndex > 0) {
          currentIndex--;
        }
      }

      updateSlider();
      resumeAutoSlide();
    });

    slider.addEventListener('mouseover', pauseAutoSlide);
    slider.addEventListener('mouseout', resumeAutoSlide);

    function goToSlide(index) {
      currentIndex = index;
      updateSlider();
    }

    function updateSlider() {
      imageSlider.style.transition = 'transform 0.5s ease';
      imageSlider.style.transform = `translateX(-${currentIndex * 100}%)`;
      
      // Update dots
      const dots = dotsContainer.querySelectorAll('.dot');
      dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === currentIndex);
      });
    }

    function startAutoSlide() {
      autoSlideInterval = setInterval(() => {
        currentIndex = (currentIndex + 1) % images.length;
        updateSlider();
      }, 3000); // Change slide every 3 seconds
    }

    function pauseAutoSlide() {
      clearInterval(autoSlideInterval);
      clearTimeout(autoSlideTimeout);
    }

    function resumeAutoSlide() {
      autoSlideTimeout = setTimeout(startAutoSlide, 5000); // Resume auto-slide after 5 seconds
    }

    // Start auto-slide initially
    startAutoSlide();
  });
}