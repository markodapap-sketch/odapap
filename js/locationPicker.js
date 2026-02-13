/**
 * LocationPicker – reusable searchable location selector for Oda Pap
 * Uses the counties data from locationData.js
 *
 * Usage:
 *   import { LocationPicker } from './js/locationPicker.js';
 *   const picker = new LocationPicker({
 *     counties: countiesData,
 *     onSave: (locationData) => { ... },
 *     currentLocation: { region, county, constituency, ward, specificLocation }
 *   });
 *   picker.open();
 */

export class LocationPicker {
  constructor(options = {}) {
    this.counties = options.counties || {};
    this.onSave = options.onSave || (() => {});
    this.current = options.currentLocation || {};
    this.selected = { ...this.current };
    this.flatList = [];
    this.overlay = null;
    this._buildFlatList();
    this._createDOM();
  }

  /* ---------- Flatten the hierarchical data for search ---------- */
  _buildFlatList() {
    this.flatList = [];
    for (const [region, countiesInRegion] of Object.entries(this.counties)) {
      for (const [county, constituencies] of Object.entries(countiesInRegion)) {
        // Add county-level entry
        this.flatList.push({
          type: 'county',
          region, county, constituency: '', ward: '',
          label: county,
          detail: this._formatRegion(region)
        });
        for (const [constituency, wards] of Object.entries(constituencies)) {
          // Add constituency-level entry
          this.flatList.push({
            type: 'area',
            region, county, constituency, ward: '',
            label: constituency,
            detail: `${county}, ${this._formatRegion(region)}`
          });
          for (const ward of wards) {
            this.flatList.push({
              type: 'ward',
              region, county, constituency, ward,
              label: ward,
              detail: `${constituency}, ${county}`
            });
          }
        }
      }
    }
  }

  _formatRegion(r) {
    return r.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /* ---------- Popular locations (Mombasa-focused + major cities) ---------- */
  _getPopular() {
    const popularAreas = [
      { constituency: 'Nyali', county: 'Mombasa' },
      { constituency: 'Kisauni', county: 'Mombasa' },
      { constituency: 'Mvita', county: 'Mombasa' },
      { constituency: 'Likoni', county: 'Mombasa' },
      { constituency: 'Changamwe', county: 'Mombasa' },
      { constituency: 'Jomvu', county: 'Mombasa' },
      { county: 'Nairobi', constituency: 'Westlands' },
      { county: 'Nairobi', constituency: 'Embakasi Central' },
      { county: 'Kiambu', constituency: 'Ruiru' },
      { county: 'Nakuru', constituency: 'Naivasha' }
    ];
    return popularAreas.map(p => {
      return this.flatList.find(
        f => f.type === 'area' &&
             f.constituency === p.constituency &&
             f.county === p.county
      );
    }).filter(Boolean);
  }

  /* ---------- Create DOM ---------- */
  _createDOM() {
    if (this.overlay) this.overlay.remove();

    const el = document.createElement('div');
    el.className = 'lp-overlay';
    el.innerHTML = `
      <div class="lp-modal">
        <div class="lp-handle"></div>
        <div class="lp-header">
          <h3><i class="fas fa-map-marker-alt"></i> Select Location</h3>
          <button class="lp-close-btn" aria-label="Close"><i class="fas fa-times"></i></button>
        </div>
        <div class="lp-search-wrap">
          <div class="lp-search">
            <i class="fas fa-search"></i>
            <input type="text" placeholder="Search county, area or ward..." autocomplete="off" id="lpSearchInput">
            <button class="lp-clear-btn" aria-label="Clear"><i class="fas fa-times"></i></button>
          </div>
        </div>
        <div class="lp-tabs">
          <button class="lp-tab active" data-tab="search"><i class="fas fa-search"></i> Search</button>
          <button class="lp-tab" data-tab="browse"><i class="fas fa-list"></i> Browse</button>
        </div>

        <div class="lp-body">
          <!-- Search results -->
          <div class="lp-search-content">
            <div class="lp-selected-summary" id="lpSelectedSummary">
              <div class="lp-sel-label"><i class="fas fa-check-circle"></i> Selected Location</div>
              <div class="lp-sel-text" id="lpSelText"></div>
              <button class="lp-sel-change" id="lpSelChange">Change</button>
            </div>
            <div id="lpResults"></div>
          </div>
          <!-- Browse (cascading dropdowns) -->
          <div class="lp-browse" id="lpBrowse">
            <div class="lp-selected-summary" id="lpBrowseSummary">
              <div class="lp-sel-label"><i class="fas fa-check-circle"></i> Selected</div>
              <div class="lp-sel-text" id="lpBrowseSelText"></div>
            </div>
            <label>Region</label>
            <select id="lpRegion">
              <option value="">Select Region</option>
            </select>
            <label>County</label>
            <select id="lpCounty" disabled><option value="">Select County</option></select>
            <label>Sub-County / Constituency</label>
            <select id="lpConstituency" disabled><option value="">Select Constituency</option></select>
            <label>Ward</label>
            <select id="lpWard" disabled><option value="">Select Ward</option></select>
          </div>
          <!-- Specific location (shared) -->
          <div class="lp-specific-wrap">
            <label><i class="fas fa-home"></i> Specific Location / Landmark</label>
            <textarea id="lpSpecific" rows="2" placeholder="E.g., Near City Mall, 2nd floor Apt 5B..."></textarea>
          </div>
        </div>

        <div class="lp-footer">
          <button class="lp-btn-cancel">Cancel</button>
          <button class="lp-btn-save" disabled><i class="fas fa-check"></i> Save Location</button>
        </div>
      </div>
    `;

    this.overlay = el;
    document.body.appendChild(el);
    this._bindEvents();
    this._populateRegions();
    this._prefillCurrent();
  }

  /* ---------- Bind events ---------- */
  _bindEvents() {
    const $ = sel => this.overlay.querySelector(sel);
    const $$ = sel => this.overlay.querySelectorAll(sel);

    // Close
    $('.lp-close-btn').addEventListener('click', () => this.close());
    $('.lp-btn-cancel').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Tabs
    $$('.lp-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.lp-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const isSearch = tab.dataset.tab === 'search';
        $('.lp-search-content').style.display = isSearch ? '' : 'none';
        $('#lpBrowse').classList.toggle('active', !isSearch);
        $('.lp-search-wrap').style.display = isSearch ? '' : 'none';
      });
    });

    // Search input
    const searchInput = $('#lpSearchInput');
    const clearBtn = $('.lp-clear-btn');
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const val = searchInput.value.trim();
      clearBtn.classList.toggle('visible', val.length > 0);
      debounceTimer = setTimeout(() => this._doSearch(val), 150);
    });
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.classList.remove('visible');
      this._showPopular();
    });

    // Browse dropdowns
    $('#lpRegion').addEventListener('change', () => this._onRegionChange());
    $('#lpCounty').addEventListener('change', () => this._onCountyChange());
    $('#lpConstituency').addEventListener('change', () => this._onConstituencyChange());
    $('#lpWard').addEventListener('change', () => this._onWardChange());

    // Save
    $('.lp-btn-save').addEventListener('click', () => this._save());

    // Selected summary change button
    $('#lpSelChange').addEventListener('click', () => {
      this.selected = {};
      this._updateSummary();
      searchInput.value = '';
      searchInput.focus();
      this._showPopular();
    });
  }

  /* ---------- Populate regions ---------- */
  _populateRegions() {
    const regionSel = this.overlay.querySelector('#lpRegion');
    Object.keys(this.counties).forEach(r => {
      regionSel.add(new Option(this._formatRegion(r), r));
    });
  }

  /* ---------- Prefill current location ---------- */
  _prefillCurrent() {
    if (this.current.specificLocation) {
      this.overlay.querySelector('#lpSpecific').value = this.current.specificLocation;
    }

    if (this.current.county) {
      this.selected = { ...this.current };
      this._updateSummary();

      // Also prefill browse dropdowns
      if (this.current.region) {
        const regionSel = this.overlay.querySelector('#lpRegion');
        regionSel.value = this.current.region;
        this._onRegionChange();
        if (this.current.county) {
          this.overlay.querySelector('#lpCounty').value = this.current.county;
          this._onCountyChange();
          if (this.current.constituency) {
            this.overlay.querySelector('#lpConstituency').value = this.current.constituency;
            this._onConstituencyChange();
            if (this.current.ward) {
              this.overlay.querySelector('#lpWard').value = this.current.ward;
            }
          }
        }
      }
    }
  }

  /* ---------- Search ---------- */
  _doSearch(query) {
    const results = this.overlay.querySelector('#lpResults');
    if (!query) {
      this._showPopular();
      return;
    }

    const q = query.toLowerCase();
    const matches = this.flatList.filter(item => {
      return item.label.toLowerCase().includes(q) ||
             item.county.toLowerCase().includes(q) ||
             item.constituency.toLowerCase().includes(q);
    }).slice(0, 30);

    if (matches.length === 0) {
      results.innerHTML = `
        <div class="lp-no-results">
          <i class="fas fa-search"></i>
          <p>No locations found for "<strong>${this._escapeHtml(query)}</strong>"</p>
          <p style="font-size:0.75rem;margin-top:6px;">Try searching for a county, area, or ward name</p>
        </div>
      `;
      return;
    }

    // Group by type
    const counties = matches.filter(m => m.type === 'county');
    const areas = matches.filter(m => m.type === 'area');
    const wards = matches.filter(m => m.type === 'ward');

    let html = '';
    if (counties.length) {
      html += `<div class="lp-section-title">Counties</div>`;
      counties.forEach(c => { html += this._renderItem(c, query); });
    }
    if (areas.length) {
      html += `<div class="lp-section-title">Sub-Counties / Areas</div>`;
      areas.forEach(a => { html += this._renderItem(a, query); });
    }
    if (wards.length) {
      html += `<div class="lp-section-title">Wards / Neighborhoods</div>`;
      wards.forEach(w => { html += this._renderItem(w, query); });
    }

    results.innerHTML = html;
    this._bindResultClicks();
  }

  _showPopular() {
    const results = this.overlay.querySelector('#lpResults');
    const popular = this._getPopular();
    let html = '<div class="lp-section-title"><i class="fas fa-fire" style="color:#ff9800;margin-right:4px;"></i> Popular Areas</div>';
    popular.forEach(item => {
      html += this._renderItem(item, '', true);
    });
    results.innerHTML = html;
    this._bindResultClicks();
  }

  _renderItem(item, query = '', isPopular = false) {
    const iconClass = isPopular ? 'popular' : item.type;
    const iconMap = { popular: 'fa-fire', county: 'fa-city', area: 'fa-map-signs', ward: 'fa-map-pin' };
    const icon = iconMap[isPopular ? 'popular' : item.type] || 'fa-map-marker-alt';
    const name = query ? this._highlightMatch(item.label, query) : item.label;
    const detail = query ? this._highlightMatch(item.detail, query) : item.detail;

    return `
      <div class="lp-item" data-region="${item.region}" data-county="${item.county}" 
           data-constituency="${item.constituency}" data-ward="${item.ward}" data-type="${item.type}">
        <div class="lp-item-icon ${iconClass}"><i class="fas ${icon}"></i></div>
        <div class="lp-item-info">
          <div class="lp-item-name">${name}</div>
          <div class="lp-item-detail">${detail}</div>
        </div>
        <i class="fas fa-chevron-right lp-item-arrow"></i>
      </div>
    `;
  }

  _highlightMatch(text, query) {
    if (!query) return this._escapeHtml(text);
    const escaped = this._escapeHtml(text);
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<span class="lp-highlight">$1</span>');
  }

  _bindResultClicks() {
    this.overlay.querySelectorAll('.lp-item').forEach(item => {
      item.addEventListener('click', () => {
        this.selected = {
          region: item.dataset.region,
          county: item.dataset.county,
          constituency: item.dataset.constituency || '',
          ward: item.dataset.ward || ''
        };
        this._updateSummary();
      });
    });
  }

  /* ---------- Browse dropdown handlers ---------- */
  _onRegionChange() {
    const region = this.overlay.querySelector('#lpRegion').value;
    const countySel = this.overlay.querySelector('#lpCounty');
    const constSel = this.overlay.querySelector('#lpConstituency');
    const wardSel = this.overlay.querySelector('#lpWard');

    countySel.innerHTML = '<option value="">Select County</option>';
    constSel.innerHTML = '<option value="">Select Constituency</option>';
    wardSel.innerHTML = '<option value="">Select Ward</option>';
    constSel.disabled = true;
    wardSel.disabled = true;

    if (region && this.counties[region]) {
      Object.keys(this.counties[region]).forEach(c => countySel.add(new Option(c, c)));
      countySel.disabled = false;
    } else {
      countySel.disabled = true;
    }
    this._syncBrowseSelection();
  }

  _onCountyChange() {
    const region = this.overlay.querySelector('#lpRegion').value;
    const county = this.overlay.querySelector('#lpCounty').value;
    const constSel = this.overlay.querySelector('#lpConstituency');
    const wardSel = this.overlay.querySelector('#lpWard');

    constSel.innerHTML = '<option value="">Select Constituency</option>';
    wardSel.innerHTML = '<option value="">Select Ward</option>';
    wardSel.disabled = true;

    if (region && county && this.counties[region]?.[county]) {
      Object.keys(this.counties[region][county]).forEach(c => constSel.add(new Option(c, c)));
      constSel.disabled = false;
    } else {
      constSel.disabled = true;
    }
    this._syncBrowseSelection();
  }

  _onConstituencyChange() {
    const region = this.overlay.querySelector('#lpRegion').value;
    const county = this.overlay.querySelector('#lpCounty').value;
    const constituency = this.overlay.querySelector('#lpConstituency').value;
    const wardSel = this.overlay.querySelector('#lpWard');

    wardSel.innerHTML = '<option value="">Select Ward</option>';

    if (this.counties[region]?.[county]?.[constituency]) {
      this.counties[region][county][constituency].forEach(w => wardSel.add(new Option(w, w)));
      wardSel.disabled = false;
    } else {
      wardSel.disabled = true;
    }
    this._syncBrowseSelection();
  }

  _onWardChange() {
    this._syncBrowseSelection();
  }

  _syncBrowseSelection() {
    const region = this.overlay.querySelector('#lpRegion').value;
    const county = this.overlay.querySelector('#lpCounty').value;
    const constituency = this.overlay.querySelector('#lpConstituency').value;
    const ward = this.overlay.querySelector('#lpWard').value;

    if (county) {
      this.selected = { region, county, constituency, ward };
    } else {
      this.selected = {};
    }

    // Update browse summary
    const summary = this.overlay.querySelector('#lpBrowseSummary');
    if (county) {
      const parts = [ward, constituency, county].filter(Boolean);
      summary.querySelector('#lpBrowseSelText').textContent = parts.join(', ');
      summary.classList.add('visible');
    } else {
      summary.classList.remove('visible');
    }

    this._updateSaveBtn();
  }

  /* ---------- Update selected summary ---------- */
  _updateSummary() {
    const summary = this.overlay.querySelector('#lpSelectedSummary');
    const saveBtn = this.overlay.querySelector('.lp-btn-save');

    if (this.selected.county) {
      const parts = [this.selected.ward, this.selected.constituency, this.selected.county].filter(Boolean);
      summary.querySelector('#lpSelText').textContent = parts.join(', ');
      summary.classList.add('visible');
      saveBtn.disabled = false;
    } else {
      summary.classList.remove('visible');
      saveBtn.disabled = true;
    }
  }

  _updateSaveBtn() {
    this.overlay.querySelector('.lp-btn-save').disabled = !this.selected.county;
  }

  /* ---------- Save ---------- */
  _save() {
    const specificLocation = this.overlay.querySelector('#lpSpecific').value.trim();
    const data = {
      region: this.selected.region || '',
      county: this.selected.county || '',
      constituency: this.selected.constituency || '',
      ward: this.selected.ward || '',
      specificLocation
    };
    this.onSave(data);
    this.close();
  }

  /* ---------- Open / Close ---------- */
  open() {
    // Refresh summary
    this._updateSummary();
    // Show popular by default
    this._showPopular();
    this.overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      this.overlay.querySelector('#lpSearchInput')?.focus();
    }, 300);
  }

  close() {
    this.overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  /** Update current location externally (e.g. after saving to Firestore) */
  updateCurrent(loc) {
    this.current = { ...loc };
    this.selected = { ...loc };
  }

  destroy() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
