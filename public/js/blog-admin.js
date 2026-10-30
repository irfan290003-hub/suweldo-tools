/**
 * SuweldoTools Blog Admin UI & Supabase CRUD Controller (Step 13B)
 * - Uses authenticated Supabase CRUD via window.__SUWELDOTOOLS_SUPABASE_ADMIN__
 * - Fetches real posts from public.blog_posts only after admin authorization
 * - Computes live Total, Published, and Draft counts from database records
 * - Supports Save Draft (status = 'draft') and Publish (status = 'published')
 * - Preserves post id and group_id when editing existing records
 * - Escapes all user-controlled content before rendering HTML
 */
(function () {
  'use strict';

  var SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var EDITOR_SNAPSHOT_STORAGE_KEY = 'suweldotools_blog_admin_unsaved_editor_v1';
  var MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
  var ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  var state = {
    posts: [],
    isLoadingPosts: false,
    fetchError: null,
    hasLoadedOnce: false,
    editingPostId: null,
    editingGroupId: null,
    editingPostRecord: null,
    languageTouched: false,
    editorDraftSnapshot: null,
    pendingDiscardCallback: null,
    activeView: 'dashboard', // 'dashboard' | 'all-posts' | 'create-post' | 'announcement'
    isSaving: null, // null | 'draft' | 'published'
    isUploadingImage: false,
    selectedImageFile: null,
    localImagePreviewUrl: null,
    publishingRowId: null,
    deletingPostId: null,
    pendingDeletePost: null,
    faqs: [],
    announcementDraft: null,
    announcementPublished: null,
    announcementDraftToken: null,
    announcementIsActive: false,
    isLoadingAnnouncement: false,
    isSavingAnnouncement: false,
    announcementHasLoaded: false,
    announcementPreviewLang: 'en'
  };

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var PREVIEW_ALLOWED_TAGS = {
    'H2': true, 'H3': true, 'H4': true,
    'P': true, 'BR': true, 'STRONG': true, 'B': true, 'EM': true, 'I': true, 'U': true, 'S': true,
    'TABLE': true, 'THEAD': true, 'TBODY': true, 'TFOOT': true, 'TR': true, 'TH': true, 'TD': true, 'CAPTION': true,
    'UL': true, 'OL': true, 'LI': true,
    'A': true,
    'CODE': true, 'PRE': true, 'BLOCKQUOTE': true,
    'HR': true
  };

  var PREVIEW_DISCARD_TAGS = {
    'SCRIPT': true, 'STYLE': true, 'TEXTAREA': true, 'OPTION': true, 'NOSCRIPT': true, 'TEMPLATE': true,
    'IFRAME': true, 'OBJECT': true, 'EMBED': true, 'FORM': true, 'INPUT': true, 'BUTTON': true, 'SELECT': true
  };

  var PREVIEW_ALLOWED_ATTRIBUTES = {
    'A': { 'href': true, 'title': true, 'target': true, 'rel': true, 'class': true },
    'TH': { 'colspan': true, 'rowspan': true, 'scope': true, 'class': true },
    'TD': { 'colspan': true, 'rowspan': true, 'scope': true, 'class': true },
    'TABLE': { 'class': true },
    'H2': { 'class': true },
    'H3': { 'class': true },
    'H4': { 'class': true },
    'P': { 'class': true },
    'UL': { 'class': true },
    'OL': { 'class': true },
    'LI': { 'class': true },
    'BLOCKQUOTE': { 'class': true },
    'PRE': { 'class': true },
    'CODE': { 'class': true },
    'HR': { 'class': true }
  };

  function isSafePreviewUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    var trimmed = rawUrl.trim();
    if (!trimmed) return false;

    // Reject protocol-relative URLs (e.g. //evil.com or \\evil.com)
    if (trimmed.startsWith('//') || trimmed.startsWith('\\\\')) {
      return false;
    }

    // Allow root-relative paths, same-page hashes, and relative paths
    if (
      trimmed.startsWith('/') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('./') ||
      trimmed.startsWith('../')
    ) {
      return true;
    }

    // Check protocols: must be http, https, or mailto
    var colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      var protocol = trimmed.slice(0, colonIdx).toLowerCase().trim();
      return protocol === 'http' || protocol === 'https' || protocol === 'mailto';
    }

    return true;
  }

  function sanitizeAdminDomNode(node, targetDoc) {
    if (!node) return null;

    // 1. Text node: safe by design (browser textContent/createTextNode automatically encodes when serialized)
    if (node.nodeType === 3 /* Node.TEXT_NODE */) {
      return targetDoc.createTextNode(node.nodeValue || '');
    }

    // 2. Element node
    if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
      var tagName = node.tagName.toUpperCase();

      // Active / executable tags to completely discard along with their children
      if (PREVIEW_DISCARD_TAGS[tagName]) {
        return null;
      }

      // Check if tag is in the explicit allowlist
      if (PREVIEW_ALLOWED_TAGS[tagName]) {
        var cleanEl = targetDoc.createElement(node.tagName.toLowerCase());

        var allowedAttrsForTag = PREVIEW_ALLOWED_ATTRIBUTES[tagName] || {};
        var attrs = node.attributes || [];
        for (var i = 0; i < attrs.length; i++) {
          var attr = attrs[i];
          var attrName = attr.name.toLowerCase();

          // Disallow any on* event handlers unconditionally
          if (attrName.startsWith('on')) {
            continue;
          }

          if (allowedAttrsForTag[attrName]) {
            if (tagName === 'A' && attrName === 'href') {
              if (isSafePreviewUrl(attr.value)) {
                cleanEl.setAttribute('href', attr.value.trim());
              }
            } else if (tagName === 'A' && attrName === 'target') {
              cleanEl.setAttribute('target', attr.value);
            } else if (tagName === 'A' && attrName === 'rel') {
              cleanEl.setAttribute('rel', attr.value);
            } else {
              cleanEl.setAttribute(attrName, attr.value);
            }
          }
        }

        // External links with target="_blank" must have rel="noopener noreferrer"
        if (tagName === 'A' && cleanEl.getAttribute('target') === '_blank') {
          var relVal = cleanEl.getAttribute('rel') || '';
          var relParts = relVal.split(/\s+/).filter(Boolean);
          if (relParts.indexOf('noopener') === -1) relParts.push('noopener');
          if (relParts.indexOf('noreferrer') === -1) relParts.push('noreferrer');
          cleanEl.setAttribute('rel', relParts.join(' '));
        }

        // Recursively sanitize all children
        var child = node.firstChild;
        while (child) {
          var cleanChild = sanitizeAdminDomNode(child, targetDoc);
          if (cleanChild) {
            cleanEl.appendChild(cleanChild);
          }
          child = child.nextSibling;
        }

        return cleanEl;
      } else {
        // Tag is not in allowlist and not active content (e.g. <div>, <span>, etc.):
        // Unwrap it by returning a fragment containing its sanitized children
        var fragment = targetDoc.createDocumentFragment();
        var unwrapChild = node.firstChild;
        while (unwrapChild) {
          var cleanUnwrapChild = sanitizeAdminDomNode(unwrapChild, targetDoc);
          if (cleanUnwrapChild) {
            fragment.appendChild(cleanUnwrapChild);
          }
          unwrapChild = unwrapChild.nextSibling;
        }
        return fragment;
      }
    }

    return null;
  }

  function sanitizeAdminHtml(rawHtml, customDoc) {
    if (!rawHtml) return '';

    var cleanDoc;
    var inertDoc;

    if (customDoc) {
      cleanDoc = customDoc;
      inertDoc = customDoc;
    } else if (typeof DOMParser !== 'undefined') {
      var parser = new DOMParser();
      inertDoc = parser.parseFromString(rawHtml, 'text/html');
      cleanDoc = document.implementation.createHTMLDocument('');
    } else if (typeof document !== 'undefined' && document.implementation && document.implementation.createHTMLDocument) {
      cleanDoc = document.implementation.createHTMLDocument('');
      var dummy = cleanDoc.createElement('div');
      dummy.innerHTML = rawHtml;
      inertDoc = { body: dummy };
    } else {
      return escapeHtml(rawHtml);
    }

    var cleanContainer = cleanDoc.createElement('div');
    var child = (inertDoc.body || inertDoc).firstChild;
    while (child) {
      var cleanChild = sanitizeAdminDomNode(child, cleanDoc);
      if (cleanChild) {
        cleanContainer.appendChild(cleanChild);
      }
      child = child.nextSibling;
    }

    return cleanContainer.innerHTML;
  }

  function renderSafeAdminArticleContent(rawContent, customDoc) {
    var normalized = String(rawContent || '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) {
      return '';
    }

    // Protect double newlines inside multi-line HTML block tags (table, pre, blockquote, ul, ol)
    var protectedText = normalized.replace(
      /<(table|pre|blockquote|ul|ol)\b[\s\S]*?<\/\1>/gi,
      function (match) {
        return match.replace(/\n{2,}/g, '\uE000');
      }
    );

    var blocks = protectedText
      .split(/\n{2,}/)
      .map(function (block) {
        return block.replace(/\uE000/g, '\n\n').trim();
      })
      .filter(Boolean);

    var renderedBlocks = blocks.map(function (block) {
      var lines = block.split('\n').map(function (line) {
        return line.trim();
      });

      // Single-line Markdown-style H2 / H3 / H4 headings
      if (lines.length === 1 && lines[0].startsWith('#### ')) {
        var h4Text = lines[0].slice(5).trim();
        return '<h4 class="text-base sm:text-lg font-bold text-slate-900 mt-4 mb-2">' + h4Text + '</h4>';
      }
      if (lines.length === 1 && lines[0].startsWith('### ')) {
        var h3Text = lines[0].slice(4).trim();
        return '<h3 class="text-lg sm:text-xl font-bold text-slate-900 mt-6 mb-2">' + h3Text + '</h3>';
      }
      if (lines.length === 1 && lines[0].startsWith('## ')) {
        var h2Text = lines[0].slice(3).trim();
        return '<h2 class="text-xl sm:text-2xl font-bold text-slate-900 mt-8 mb-3">' + h2Text + '</h2>';
      }

      // Markdown horizontal rule (---, ***, ___)
      if (lines.length === 1 && /^(?:---|\*\*\*|___)$/.test(lines[0])) {
        return '<hr class="my-8 border-slate-200" />';
      }

      // Unordered list block (standalone or preceded by leading text without blank line)
      var isAllUnordered =
        lines.length > 0 &&
        lines.every(function (line) {
          return /^[-*]\s+.+/.test(line);
        });
      if (isAllUnordered) {
        var ulItems = lines
          .map(function (line) {
            return line.replace(/^[-*]\s+/, '').trim();
          })
          .map(function (item) {
            return '<li class="leading-relaxed">' + item + '</li>';
          })
          .join('\n              ');
        return '<ul class="list-disc pl-5 space-y-2 text-slate-700 my-4">\n              ' + ulItems + '\n            </ul>';
      }

      var firstUnorderedIdx = lines.findIndex(function (line) {
        return /^[-*]\s+.+/.test(line);
      });
      if (
        firstUnorderedIdx > 0 &&
        lines.slice(firstUnorderedIdx).every(function (line) {
          return /^[-*]\s+.+/.test(line);
        })
      ) {
        var pUlLines = lines.slice(0, firstUnorderedIdx).join('<br />\n              ');
        var splitUlItems = lines
          .slice(firstUnorderedIdx)
          .map(function (line) {
            return line.replace(/^[-*]\s+/, '').trim();
          })
          .map(function (item) {
            return '<li class="leading-relaxed">' + item + '</li>';
          })
          .join('\n              ');
        return '<p class="text-base text-slate-700 leading-relaxed my-4">\n              ' + pUlLines + '\n            </p>\n            <ul class="list-disc pl-5 space-y-2 text-slate-700 my-4">\n              ' + splitUlItems + '\n            </ul>';
      }

      // Ordered list block (standalone or preceded by leading text without blank line)
      var isAllOrdered =
        lines.length > 0 &&
        lines.every(function (line) {
          return /^\d+\.\s+.+/.test(line);
        });
      if (isAllOrdered) {
        var olItems = lines
          .map(function (line) {
            return line.replace(/^\d+\.\s+/, '').trim();
          })
          .map(function (item) {
            return '<li class="leading-relaxed">' + item + '</li>';
          })
          .join('\n              ');
        return '<ol class="list-decimal pl-5 space-y-2 text-slate-700 my-4">\n              ' + olItems + '\n            </ol>';
      }

      var firstOrderedIdx = lines.findIndex(function (line) {
        return /^\d+\.\s+.+/.test(line);
      });
      if (
        firstOrderedIdx > 0 &&
        lines.slice(firstOrderedIdx).every(function (line) {
          return /^\d+\.\s+.+/.test(line);
        })
      ) {
        var pOlLines = lines.slice(0, firstOrderedIdx).join('<br />\n              ');
        var splitOlItems = lines
          .slice(firstOrderedIdx)
          .map(function (line) {
            return line.replace(/^\d+\.\s+/, '').trim();
          })
          .map(function (item) {
            return '<li class="leading-relaxed">' + item + '</li>';
          })
          .join('\n              ');
        return '<p class="text-base text-slate-700 leading-relaxed my-4">\n              ' + pOlLines + '\n            </p>\n            <ol class="list-decimal pl-5 space-y-2 text-slate-700 my-4">\n              ' + splitOlItems + '\n            </ol>';
      }

      // Check if the block is already an HTML block element
      var isHtmlBlock = /^\s*<(table|thead|tbody|tfoot|tr|th|td|caption|h[2-4]|ul|ol|li|p|blockquote|pre|hr)\b/i.test(block);
      if (isHtmlBlock) {
        return block;
      }

      // Standard paragraph block: internal line breaks become <br />
      var paragraphHtml = lines.join('<br />\n              ');
      return '<p class="text-base text-slate-700 leading-relaxed my-4">\n              ' + paragraphHtml + '\n            </p>';
    });

    var assembledHtml = renderedBlocks.join('\n            ');
    return sanitizeAdminHtml(assembledHtml, customDoc);
  }

  // Expose preview sanitizer helpers for browser and testing inspection
  if (typeof window !== 'undefined') {
    window.__SUWELDOTOOLS_BLOG_PREVIEW_RENDERER__ = {
      renderSafeAdminArticleContent: renderSafeAdminArticleContent,
      sanitizeAdminHtml: sanitizeAdminHtml,
      isSafePreviewUrl: isSafePreviewUrl,
      sanitizeAdminDomNode: sanitizeAdminDomNode
    };
  }

  // In Node/Bun testing environments or when imported, export sanitizers and skip browser DOM controller binding
  if (typeof document === 'undefined' || !document.getElementById || !document.getElementById('blog-post-form')) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        PREVIEW_ALLOWED_TAGS: PREVIEW_ALLOWED_TAGS,
        PREVIEW_DISCARD_TAGS: PREVIEW_DISCARD_TAGS,
        PREVIEW_ALLOWED_ATTRIBUTES: PREVIEW_ALLOWED_ATTRIBUTES,
        isSafePreviewUrl: isSafePreviewUrl,
        sanitizeAdminDomNode: sanitizeAdminDomNode,
        sanitizeAdminHtml: sanitizeAdminHtml,
        renderSafeAdminArticleContent: renderSafeAdminArticleContent,
        escapeHtml: escapeHtml
      };
    }
    return;
  }

  // DOM Elements: Navigation & Filters
  var navButtons = document.querySelectorAll('.admin-nav-btn');
  var globalLangFilter = document.getElementById('global-language-filter');
  var tableLangSelect = document.getElementById('table-language-select');
  var tableStatusSelect = document.getElementById('table-status-select');
  var searchInput = document.getElementById('post-search-input');
  var tableBody = document.getElementById('posts-table-body');
  var resultsCountEl = document.getElementById('table-results-count');
  var btnRefreshPosts = document.getElementById('btn-refresh-posts');
  var btnTableCreateNewPost = document.getElementById('btn-table-create-new-post');
  var tableErrorBanner = document.getElementById('posts-table-error-banner');
  var tableErrorMessage = document.getElementById('posts-table-error-message');
  var btnRetryFetchPosts = document.getElementById('btn-retry-fetch-posts');

  // DOM Elements: Dashboard Metrics & Recent Posts
  var metricTotalEl = document.getElementById('metric-total-posts');
  var metricTotalSubEl = document.getElementById('metric-total-posts-sub');
  var metricPublishedEl = document.getElementById('metric-published-posts');
  var metricDraftEl = document.getElementById('metric-draft-posts');
  var dashboardRecentPostsBody = document.getElementById('dashboard-recent-posts-body');
  var btnDashboardViewAllPosts = document.getElementById('btn-dashboard-view-all-posts');

  // DOM Elements: Active Editor Session Banner
  var activeEditorSessionBanner = document.getElementById('active-editor-session-banner');
  var activeEditorSessionText = document.getElementById('active-editor-session-text');
  var btnResumeEditorSession = document.getElementById('btn-resume-editor-session');

  // DOM Elements: Sections
  var sectionDashboard = document.getElementById('section-dashboard');
  var sectionPostsTable = document.getElementById('section-posts-table');
  var sectionPostEditor = document.getElementById('section-post-editor');
  var sectionPostPreview = document.getElementById('section-post-preview');
  var sectionAnnouncementAdmin = document.getElementById('section-announcement-admin');

  // DOM Elements: Announcement Management
  var announcementActiveBadge = document.getElementById('announcement-active-badge');
  var btnToggleAnnouncementActive = document.getElementById('btn-toggle-announcement-active');
  var btnToggleAnnouncementLabel = document.getElementById('btn-toggle-announcement-label');
  var btnRefreshAnnouncement = document.getElementById('btn-refresh-announcement');
  var announcementTokenDisplay = document.getElementById('announcement-token-display');
  var announcementLastUpdatedText = document.getElementById('announcement-last-updated-text');
  var announcementConflictBanner = document.getElementById('announcement-conflict-banner');
  var announcementConflictMessage = document.getElementById('announcement-conflict-message');
  var btnReloadAnnouncementDraft = document.getElementById('btn-reload-announcement-draft');
  var announcementFeedbackBanner = document.getElementById('announcement-feedback-banner');
  var announcementFeedbackTitle = document.getElementById('announcement-feedback-title');
  var announcementFeedbackBody = document.getElementById('announcement-feedback-body');

  var announcementForm = document.getElementById('announcement-form');
  var inputAnnTitleEn = document.getElementById('announcement-title-en');
  var inputAnnBodyEn = document.getElementById('announcement-body-en');
  var inputAnnTitleTl = document.getElementById('announcement-title-tl');
  var inputAnnBodyTl = document.getElementById('announcement-body-tl');
  var inputAnnImageUrl = document.getElementById('announcement-image-url');
  var inputAnnImageAltEn = document.getElementById('announcement-image-alt-en');
  var inputAnnImageAltTl = document.getElementById('announcement-image-alt-tl');
  var inputAnnLinkUrl = document.getElementById('announcement-link-url');
  var inputAnnLinkLabelEn = document.getElementById('announcement-link-label-en');
  var inputAnnLinkLabelTl = document.getElementById('announcement-link-label-tl');
  var btnSaveAnnouncementDraft = document.getElementById('btn-save-announcement-draft');
  var btnSaveAnnouncementDraftLabel = document.getElementById('btn-save-announcement-draft-label');
  var btnPublishAnnouncement = document.getElementById('btn-publish-announcement');
  var btnPublishAnnouncementLabel = document.getElementById('btn-publish-announcement-label');

  // Preview elements
  var btnPreviewLangEn = document.getElementById('btn-preview-lang-en');
  var btnPreviewLangTl = document.getElementById('btn-preview-lang-tl');
  var annPreviewTitle = document.getElementById('announcement-preview-title');
  var annPreviewImageBox = document.getElementById('announcement-preview-image-box');
  var annPreviewImageImg = document.getElementById('announcement-preview-image-img');
  var annPreviewBody = document.getElementById('announcement-preview-body');
  var annPreviewCtaBox = document.getElementById('announcement-preview-cta-box');
  var annPreviewCtaLabel = document.getElementById('announcement-preview-cta-label');

  // DOM Elements: Editor Controls
  var btnCreateNewPost = document.getElementById('btn-create-new-post');
  var btnBackToPosts = document.getElementById('btn-back-to-posts');
  var btnResetForm = document.getElementById('btn-reset-form');
  var btnGenerateSlug = document.getElementById('btn-generate-slug');
  var btnPreviewPost = document.getElementById('btn-preview-post');
  var btnClosePreview = document.getElementById('btn-close-preview');
  var btnSaveDraft = document.getElementById('btn-save-draft');
  var btnSaveDraftLabel = document.getElementById('btn-save-draft-label');
  var btnPublishPost = document.getElementById('btn-publish-post');
  var btnPublishPostLabel = document.getElementById('btn-publish-post-label');
  var editorActionHint = document.getElementById('editor-action-hint');

  // DOM Elements: Form Inputs
  var form = document.getElementById('blog-post-form');
  var inputLanguage = document.getElementById('post-language');
  var inputTitle = document.getElementById('post-title');
  var inputSlug = document.getElementById('post-slug');
  var slugPrefixDisplay = document.getElementById('slug-prefix-display');
  var inputAuthorName = document.getElementById('post-author-name');
  var inputExcerpt = document.getElementById('post-excerpt');
  var inputContent = document.getElementById('post-content');
  var inputSeoTitle = document.getElementById('post-seo-title');
  var inputMetaDesc = document.getElementById('post-meta-description');
  var inputImageUrl = document.getElementById('post-image-url');
  var inputImageAlt = document.getElementById('post-image-alt');
  var faqsListEl = document.getElementById('post-faqs-list');
  var faqsEmptyEl = document.getElementById('post-faqs-empty');
  var btnAddFaq = document.getElementById('btn-add-faq');
  var inputImageFile = document.getElementById('post-image-file-input');
  var btnUploadImage = document.getElementById('btn-upload-image');
  var btnUploadImageLabel = document.getElementById('btn-upload-image-label');
  var btnClearImage = document.getElementById('btn-clear-image');
  var imageUploadStatusBanner = document.getElementById('post-image-upload-status');
  var imageUploadStatusTitle = document.getElementById('post-image-upload-status-title');
  var imageUploadStatusBody = document.getElementById('post-image-upload-status-body');
  var imagePreviewCard = document.getElementById('post-image-preview-card');
  var imagePreviewImg = document.getElementById('post-image-preview-img');
  var imagePreviewError = document.getElementById('post-image-preview-error');
  var imagePreviewBadge = document.getElementById('post-image-preview-badge');
  var imagePreviewSource = document.getElementById('post-image-preview-source');
  var imagePreviewAltSummary = document.getElementById('post-image-preview-alt-summary');

  // DOM Elements: Editor Header & Active Record Metadata
  var editorModeLabel = document.getElementById('editor-mode-label');
  var editorHeading = document.getElementById('editor-heading');
  var editorRecordMeta = document.getElementById('editor-record-meta');
  var editorRecordId = document.getElementById('editor-record-id');
  var editorRecordGroupId = document.getElementById('editor-record-group-id');
  var editorRecordTimestamps = document.getElementById('editor-record-timestamps');
  var editorRecordStatusBadge = document.getElementById('editor-record-status-badge');

  // DOM Elements: Counters
  var authorNameCharCount = document.getElementById('author-name-char-count');
  var excerptCharCount = document.getElementById('excerpt-char-count');
  var contentWordCount = document.getElementById('content-word-count');
  var seoTitleCharCount = document.getElementById('seo-title-char-count');
  var metaDescCharCount = document.getElementById('meta-desc-char-count');

  // DOM Elements: Validation & CRUD Feedback Banners
  var validationSummary = document.getElementById('form-validation-summary');
  var validationList = document.getElementById('form-validation-list');
  var validationSuccess = document.getElementById('form-validation-success');
  var crudFeedbackBanner = document.getElementById('form-crud-feedback');
  var crudFeedbackTitle = document.getElementById('form-crud-feedback-title');
  var crudFeedbackBody = document.getElementById('form-crud-feedback-body');
  var tableCrudFeedbackBanner = document.getElementById('posts-table-crud-feedback');
  var tableCrudFeedbackTitle = document.getElementById('posts-table-crud-feedback-title');
  var tableCrudFeedbackBody = document.getElementById('posts-table-crud-feedback-body');

  // DOM Elements: Delete Confirmation Modal
  var deletePostModal = document.getElementById('delete-post-modal');
  var deleteModalPostTitle = document.getElementById('delete-modal-post-title');
  var deleteModalPostStatus = document.getElementById('delete-modal-post-status');
  var deleteModalPostSlug = document.getElementById('delete-modal-post-slug');
  var deleteModalPostId = document.getElementById('delete-modal-post-id');
  var btnCancelDeletePost = document.getElementById('btn-cancel-delete-post');
  var btnConfirmDeletePost = document.getElementById('btn-confirm-delete-post');
  var btnConfirmDeleteLabel = document.getElementById('btn-confirm-delete-label');

  // DOM Elements: Unsaved Changes Confirmation Modal
  var unsavedChangesModal = document.getElementById('unsaved-changes-modal');
  var unsavedChangesModalTitle = document.getElementById('unsaved-changes-modal-title');
  var unsavedChangesModalDesc = document.getElementById('unsaved-changes-modal-description');
  var unsavedModalCurrentSummary = document.getElementById('unsaved-modal-current-summary');
  var unsavedModalTargetSummary = document.getElementById('unsaved-modal-target-summary');
  var btnCancelDiscardChanges = document.getElementById('btn-cancel-discard-changes');
  var btnConfirmDiscardChanges = document.getElementById('btn-confirm-discard-changes');

  function isValidUuid(value) {
    return typeof value === 'string' && UUID_REGEX.test(value.trim());
  }


  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function formatTimestamp(isoString) {
    if (!isoString) return '—';
    try {
      var date = new Date(isoString);
      if (isNaN(date.getTime())) return String(isoString);
      return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_err) {
      return String(isoString);
    }
  }

  function shortUuid(uuidStr) {
    var s = String(uuidStr || '');
    return s.length > 12 ? s.slice(0, 8) + '…' : s;
  }

  function updateSlugPrefix() {
    if (!inputLanguage || !slugPrefixDisplay) return;
    slugPrefixDisplay.textContent =
      inputLanguage.value === 'tl'
        ? 'https://suweldotools.com/tl/blog/'
        : 'https://suweldotools.com/blog/';
  }

  function renderCrudFeedback(variant, title, body) {
    if (!crudFeedbackBanner || !crudFeedbackTitle || !crudFeedbackBody) return;
    if (!variant) {
      crudFeedbackBanner.classList.add('hidden');
      crudFeedbackTitle.textContent = '';
      crudFeedbackBody.textContent = '';
      return;
    }

    crudFeedbackTitle.textContent = title || '';
    crudFeedbackBody.textContent = body || '';
    crudFeedbackBanner.classList.remove('hidden');

    if (variant === 'success') {
      crudFeedbackBanner.className =
        'mx-5 sm:mx-6 mt-5 p-4 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 text-sm';
    } else if (variant === 'warning') {
      crudFeedbackBanner.className =
        'mx-5 sm:mx-6 mt-5 p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm';
    } else {
      crudFeedbackBanner.className =
        'mx-5 sm:mx-6 mt-5 p-4 rounded-xl border border-red-300 bg-red-50 text-red-900 text-sm';
    }
  }

  function renderTableCrudFeedback(variant, title, body) {
    if (!tableCrudFeedbackBanner || !tableCrudFeedbackTitle || !tableCrudFeedbackBody) return;
    if (!variant) {
      tableCrudFeedbackBanner.classList.add('hidden');
      tableCrudFeedbackTitle.textContent = '';
      tableCrudFeedbackBody.textContent = '';
      return;
    }

    tableCrudFeedbackTitle.textContent = title || '';
    tableCrudFeedbackBody.textContent = body || '';
    tableCrudFeedbackBanner.classList.remove('hidden');

    if (variant === 'success') {
      tableCrudFeedbackBanner.className =
        'rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 p-3.5 text-xs';
    } else if (variant === 'warning') {
      tableCrudFeedbackBanner.className =
        'rounded-xl border border-amber-300 bg-amber-50 text-amber-900 p-3.5 text-xs';
    } else {
      tableCrudFeedbackBanner.className =
        'rounded-xl border border-red-300 bg-red-50 text-red-900 p-3.5 text-xs';
    }
  }

  function formatFileSize(bytes) {
    var num = Number(bytes) || 0;
    if (num < 1024) return num + ' B';
    if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
    return (num / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function validateImageFileClient(file) {
    if (!file) {
      return {
        valid: false,
        error: 'Please choose a JPEG, PNG, or WebP image file before uploading.'
      };
    }

    var mimeType = String(file.type || '').toLowerCase();
    if (ALLOWED_IMAGE_MIME_TYPES.indexOf(mimeType) === -1) {
      return {
        valid: false,
        error:
          'Unsupported file type (' +
          (mimeType || 'unknown') +
          '). Only JPEG (.jpg/.jpeg), PNG (.png), and WebP (.webp) images are allowed.'
      };
    }

    if (typeof file.size !== 'number' || file.size <= 0) {
      return {
        valid: false,
        error: 'The selected image file is empty (0 bytes). Please choose a valid image.'
      };
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
      return {
        valid: false,
        error:
          'File size (' +
          formatFileSize(file.size) +
          ') exceeds the 5 MB maximum limit. Please compress or resize the image before uploading.'
      };
    }

    return { valid: true, error: null };
  }

  function renderImageUploadStatus(variant, title, body) {
    if (!imageUploadStatusBanner || !imageUploadStatusTitle || !imageUploadStatusBody) return;
    if (!variant) {
      imageUploadStatusBanner.classList.add('hidden');
      imageUploadStatusTitle.textContent = '';
      imageUploadStatusBody.textContent = '';
      return;
    }

    imageUploadStatusTitle.textContent = title || '';
    imageUploadStatusBody.textContent = body || '';
    imageUploadStatusBanner.classList.remove('hidden');

    if (variant === 'success') {
      imageUploadStatusBanner.className =
        'rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 px-3 py-2.5 text-xs leading-relaxed';
    } else if (variant === 'info') {
      imageUploadStatusBanner.className =
        'rounded-lg border border-slate-300 bg-slate-50 text-slate-800 px-3 py-2.5 text-xs leading-relaxed';
    } else if (variant === 'warning') {
      imageUploadStatusBanner.className =
        'rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2.5 text-xs leading-relaxed';
    } else {
      imageUploadStatusBanner.className =
        'rounded-lg border border-red-300 bg-red-50 text-red-900 px-3 py-2.5 text-xs leading-relaxed';
    }
  }

  function revokeLocalImagePreviewUrl() {
    if (state.localImagePreviewUrl) {
      try {
        if (window.URL && typeof window.URL.revokeObjectURL === 'function') {
          window.URL.revokeObjectURL(state.localImagePreviewUrl);
        }
      } catch (_err) {
        // Ignore URL revoke errors
      }
      state.localImagePreviewUrl = null;
    }
  }

  function clearSelectedImageFileSelection(keepUploadStatus) {
    state.selectedImageFile = null;
    revokeLocalImagePreviewUrl();
    if (inputImageFile) {
      inputImageFile.value = '';
    }
    if (!keepUploadStatus) {
      renderImageUploadStatus(null);
    }
  }

  function updateEditorImagePreview() {
    var urlVal = inputImageUrl ? inputImageUrl.value.trim() : '';
    var altVal = inputImageAlt ? inputImageAlt.value.trim() : '';
    var hasSelectedFile = Boolean(state.selectedImageFile);

    if (btnClearImage) {
      if (urlVal || altVal || hasSelectedFile) {
        btnClearImage.classList.remove('hidden');
      } else {
        btnClearImage.classList.add('hidden');
      }
      btnClearImage.disabled = Boolean(state.isUploadingImage) || Boolean(state.isSaving);
    }

    if (!imagePreviewCard || !imagePreviewImg) return;

    if (hasSelectedFile && state.localImagePreviewUrl) {
      imagePreviewCard.classList.remove('hidden');
      if (imagePreviewError) imagePreviewError.classList.add('hidden');
      imagePreviewImg.classList.remove('hidden');
      imagePreviewImg.src = state.localImagePreviewUrl;
      imagePreviewImg.alt = altVal || state.selectedImageFile.name || 'Selected image preview';

      if (imagePreviewBadge) {
        imagePreviewBadge.textContent = state.isUploadingImage
          ? 'Uploading to Supabase Storage…'
          : 'Selected File (Click Upload Image)';
        imagePreviewBadge.className =
          'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200';
      }
      if (imagePreviewSource) {
        imagePreviewSource.textContent =
          state.selectedImageFile.name +
          ' (' +
          formatFileSize(state.selectedImageFile.size) +
          ')' +
          (urlVal ? ' · Current URL: ' + urlVal : '');
      }
      if (imagePreviewAltSummary) {
        imagePreviewAltSummary.textContent = altVal
          ? 'Alt Text: ' + altVal
          : 'Alt Text: Not set yet (required before saving or publishing)';
      }
      return;
    }

    if (urlVal) {
      var isValidPrefix =
        urlVal.indexOf('https://') === 0 ||
        urlVal.indexOf('http://') === 0 ||
        urlVal.indexOf('/') === 0;

      imagePreviewCard.classList.remove('hidden');

      if (isValidPrefix) {
        if (imagePreviewError) imagePreviewError.classList.add('hidden');
        imagePreviewImg.classList.remove('hidden');
        if (imagePreviewImg.getAttribute('src') !== urlVal) {
          imagePreviewImg.src = urlVal;
        }
        imagePreviewImg.alt = altVal || 'Featured image preview';
      } else {
        imagePreviewImg.classList.add('hidden');
        imagePreviewImg.removeAttribute('src');
        if (imagePreviewError) {
          imagePreviewError.textContent = 'URL must start with https://, http://, or /';
          imagePreviewError.classList.remove('hidden');
        }
      }

      if (imagePreviewBadge) {
        var isSupabaseStorageUrl = urlVal.indexOf('/storage/v1/object/public/blog-images/') !== -1;
        imagePreviewBadge.textContent = !isValidPrefix
          ? 'Invalid Image URL Format'
          : isSupabaseStorageUrl
            ? 'Supabase Storage Image URL'
            : 'Active Image URL';
        imagePreviewBadge.className = !isValidPrefix
          ? 'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-800 border border-red-200'
          : 'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200';
      }
      if (imagePreviewSource) {
        imagePreviewSource.textContent = urlVal;
      }
      if (imagePreviewAltSummary) {
        imagePreviewAltSummary.textContent = altVal
          ? 'Alt Text: ' + altVal
          : 'Alt Text: Required whenever a Featured Image URL is provided';
      }
      return;
    }

    imagePreviewCard.classList.add('hidden');
    imagePreviewImg.classList.add('hidden');
    imagePreviewImg.removeAttribute('src');
    if (imagePreviewError) imagePreviewError.classList.add('hidden');
  }

  function normalizeFaqArray(rawFaqs) {
    if (!Array.isArray(rawFaqs)) return [];
    var out = [];
    for (var i = 0; i < rawFaqs.length; i++) {
      var item = rawFaqs[i];
      if (!item || typeof item !== 'object') continue;
      out.push({
        question: typeof item.question === 'string' ? item.question : '',
        answer: typeof item.answer === 'string' ? item.answer : ''
      });
    }
    return out;
  }

  function getCleanFaqsForSubmit(rawFaqs) {
    var list = Array.isArray(rawFaqs) ? rawFaqs : state.faqs;
    var cleaned = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object') continue;
      var q = typeof item.question === 'string' ? item.question.trim() : '';
      var a = typeof item.answer === 'string' ? item.answer.trim() : '';
      if (q && a) {
        cleaned.push({ question: q, answer: a });
      }
    }
    return cleaned;
  }

  function findFirstIncompleteFaqRowIndex(rawFaqs) {
    var list = Array.isArray(rawFaqs) ? rawFaqs : state.faqs;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object') continue;
      var q = typeof item.question === 'string' ? item.question.trim() : '';
      var a = typeof item.answer === 'string' ? item.answer.trim() : '';
      if ((q && !a) || (!q && a)) {
        return i;
      }
    }
    return -1;
  }

  function serializeFaqsForComparison(rawFaqs) {
    var list = Array.isArray(rawFaqs) ? rawFaqs : [];
    var normalized = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object') continue;
      var q = typeof item.question === 'string' ? item.question.trim() : '';
      var a = typeof item.answer === 'string' ? item.answer.trim() : '';
      if (!q && !a) continue;
      normalized.push({ question: q, answer: a });
    }
    return JSON.stringify(normalized);
  }

  function renderFaqRepeater() {
    if (!faqsListEl || !faqsEmptyEl) return;

    var items = Array.isArray(state.faqs) ? state.faqs : [];
    if (items.length === 0) {
      faqsListEl.innerHTML = '';
      faqsListEl.classList.add('hidden');
      faqsEmptyEl.classList.remove('hidden');
      return;
    }

    faqsEmptyEl.classList.add('hidden');
    faqsListEl.classList.remove('hidden');

    var isBusy =
      Boolean(state.isSaving) ||
      Boolean(state.deletingPostId) ||
      Boolean(state.isUploadingImage);

    faqsListEl.innerHTML = items
      .map(function (faq, idx) {
        var isFirst = idx === 0;
        var isLast = idx === items.length - 1;
        return (
          '<div class="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 space-y-3" data-faq-row="' +
          idx +
          '">' +
          '<div class="flex items-center justify-between gap-2">' +
          '<span class="text-xs font-bold uppercase tracking-wider text-emerald-800">FAQ #' +
          (idx + 1) +
          '</span>' +
          '<div class="inline-flex items-center gap-1.5">' +
          '<button type="button" data-faq-action="move-up" data-faq-index="' +
          idx +
          '" ' +
          (isFirst || isBusy ? 'disabled ' : '') +
          'title="Move FAQ up" class="text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">&uarr;</button>' +
          '<button type="button" data-faq-action="move-down" data-faq-index="' +
          idx +
          '" ' +
          (isLast || isBusy ? 'disabled ' : '') +
          'title="Move FAQ down" class="text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">&darr;</button>' +
          '<button type="button" data-faq-action="remove" data-faq-index="' +
          idx +
          '" ' +
          (isBusy ? 'disabled ' : '') +
          'class="text-xs font-semibold text-red-700 hover:text-red-800 bg-white hover:bg-red-50 border border-red-200 px-2.5 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Remove</button>' +
          '</div>' +
          '</div>' +
          '<div>' +
          '<label for="post-faq-question-' +
          idx +
          '" class="block text-xs font-semibold text-slate-800 mb-1">Question <span class="text-red-600" aria-hidden="true">*</span></label>' +
          '<input type="text" id="post-faq-question-' +
          idx +
          '" data-faq-field="question" data-faq-index="' +
          idx +
          '" value="' +
          escapeHtml(faq.question) +
          '" placeholder="e.g., Is 13th month pay taxable in the Philippines?" class="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-lg px-3 py-2 focus:border-emerald-600" />' +
          '</div>' +
          '<div>' +
          '<label for="post-faq-answer-' +
          idx +
          '" class="block text-xs font-semibold text-slate-800 mb-1">Answer <span class="text-red-600" aria-hidden="true">*</span></label>' +
          '<textarea id="post-faq-answer-' +
          idx +
          '" data-faq-field="answer" data-faq-index="' +
          idx +
          '" rows="2" placeholder="Provide a clear, accurate answer that matches the article content..." class="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-lg px-3 py-2 focus:border-emerald-600">' +
          escapeHtml(faq.answer) +
          '</textarea>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function getFormValues() {
    return {
      language: inputLanguage && inputLanguage.value === 'tl' ? 'tl' : 'en',
      title: inputTitle ? inputTitle.value.trim() : '',
      slug: inputSlug ? inputSlug.value.trim() : '',
      author_name: inputAuthorName ? inputAuthorName.value.trim() : '',
      excerpt: inputExcerpt ? inputExcerpt.value.trim() : '',
      content: inputContent ? inputContent.value.trim() : '',
      seo_title: inputSeoTitle ? inputSeoTitle.value.trim() : '',
      meta_description: inputMetaDesc ? inputMetaDesc.value.trim() : '',
      featured_image_url: inputImageUrl ? inputImageUrl.value.trim() : '',
      featured_image_alt: inputImageAlt ? inputImageAlt.value.trim() : '',
      faqs: getCleanFaqsForSubmit(state.faqs)
    };
  }

  function getRawEditorValues() {
    return {
      language: inputLanguage && inputLanguage.value === 'tl' ? 'tl' : 'en',
      title: inputTitle ? inputTitle.value : '',
      slug: inputSlug ? inputSlug.value : '',
      author_name: inputAuthorName ? inputAuthorName.value : '',
      excerpt: inputExcerpt ? inputExcerpt.value : '',
      content: inputContent ? inputContent.value : '',
      seo_title: inputSeoTitle ? inputSeoTitle.value : '',
      meta_description: inputMetaDesc ? inputMetaDesc.value : '',
      featured_image_url: inputImageUrl ? inputImageUrl.value : '',
      featured_image_alt: inputImageAlt ? inputImageAlt.value : '',
      faqs: normalizeFaqArray(state.faqs)
    };
  }

  function hasAnyDomTextValue(raw) {
    var v = raw || getRawEditorValues();
    var hasFaqContent = Array.isArray(v.faqs) && v.faqs.some(function (f) {
      return Boolean((f.question && f.question.trim()) || (f.answer && f.answer.trim()));
    });
    return Boolean(
      v.title.trim() ||
        v.slug.trim() ||
        v.author_name.trim() ||
        v.excerpt.trim() ||
        v.content.trim() ||
        v.seo_title.trim() ||
        v.meta_description.trim() ||
        v.featured_image_url.trim() ||
        v.featured_image_alt.trim() ||
        hasFaqContent
    );
  }

  function hasUnsavedEditorChanges() {
    var raw = getRawEditorValues();

    if (state.editingPostId && state.editingPostRecord) {
      var rec = state.editingPostRecord;
      var recLang = rec.language === 'tl' ? 'tl' : 'en';
      return (
        raw.language !== recLang ||
        raw.title !== (rec.title || '') ||
        raw.slug !== (rec.slug || '') ||
        raw.author_name !== (rec.author_name || '') ||
        raw.excerpt !== (rec.excerpt || '') ||
        raw.content !== (rec.content || '') ||
        raw.seo_title !== (rec.seo_title || '') ||
        raw.meta_description !== (rec.meta_description || '') ||
        raw.featured_image_url !== (rec.featured_image_url || '') ||
        raw.featured_image_alt !== (rec.featured_image_alt || '') ||
        serializeFaqsForComparison(raw.faqs) !== serializeFaqsForComparison(rec.faqs) ||
        findFirstIncompleteFaqRowIndex(raw.faqs) !== -1
      );
    }

    return hasAnyDomTextValue(raw) || Boolean(state.languageTouched);
  }

  function captureEditorSnapshot() {
    var raw = getRawEditorValues();
    return {
      editingPostId: state.editingPostId || null,
      editingGroupId: state.editingGroupId || null,
      language: raw.language,
      title: raw.title,
      slug: raw.slug,
      author_name: raw.author_name,
      excerpt: raw.excerpt,
      content: raw.content,
      seo_title: raw.seo_title,
      meta_description: raw.meta_description,
      featured_image_url: raw.featured_image_url,
      featured_image_alt: raw.featured_image_alt,
      faqs: normalizeFaqArray(raw.faqs),
      languageTouched: Boolean(state.languageTouched)
    };
  }

  function saveEditorSnapshot() {
    var snapshot = captureEditorSnapshot();
    state.editorDraftSnapshot = snapshot;

    try {
      // Only persist unsaved NEW-POST drafts in sessionStorage; never persist a previously edited database record
      if (!state.editingPostId && hasUnsavedEditorChanges()) {
        window.sessionStorage.setItem(
          EDITOR_SNAPSHOT_STORAGE_KEY,
          JSON.stringify(snapshot)
        );
      } else {
        window.sessionStorage.removeItem(EDITOR_SNAPSHOT_STORAGE_KEY);
      }
    } catch (_err) {
      // Ignore storage quota or privacy-mode exceptions; in-memory snapshot still works
    }
  }

  function clearEditorSnapshot() {
    state.editorDraftSnapshot = null;
    state.languageTouched = false;
    try {
      window.sessionStorage.removeItem(EDITOR_SNAPSHOT_STORAGE_KEY);
    } catch (_err) {
      // Ignore storage exceptions
    }
  }

  function applyEditorSnapshotToDom(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;

    if (inputLanguage) {
      inputLanguage.value = snapshot.language === 'tl' ? 'tl' : 'en';
    }
    if (inputTitle && typeof snapshot.title === 'string') {
      inputTitle.value = snapshot.title;
    }
    if (inputSlug && typeof snapshot.slug === 'string') {
      inputSlug.value = snapshot.slug;
    }
    if (inputAuthorName && typeof snapshot.author_name === 'string') {
      inputAuthorName.value = snapshot.author_name;
    }
    if (inputExcerpt && typeof snapshot.excerpt === 'string') {
      inputExcerpt.value = snapshot.excerpt;
    }
    if (inputContent && typeof snapshot.content === 'string') {
      inputContent.value = snapshot.content;
    }
    if (inputSeoTitle && typeof snapshot.seo_title === 'string') {
      inputSeoTitle.value = snapshot.seo_title;
    }
    if (inputMetaDesc && typeof snapshot.meta_description === 'string') {
      inputMetaDesc.value = snapshot.meta_description;
    }
    if (inputImageUrl && typeof snapshot.featured_image_url === 'string') {
      inputImageUrl.value = snapshot.featured_image_url;
    }
    if (inputImageAlt && typeof snapshot.featured_image_alt === 'string') {
      inputImageAlt.value = snapshot.featured_image_alt;
    }
    if (Array.isArray(snapshot.faqs)) {
      state.faqs = normalizeFaqArray(snapshot.faqs);
      renderFaqRepeater();
    }

    state.languageTouched = Boolean(snapshot.languageTouched);
    updateSlugPrefix();
    updateEditorImagePreview();
    updateCounters();
  }

  function restoreEditorSnapshotOnInitIfEmpty() {
    // Never overwrite live unsaved user input already in the DOM
    if (hasAnyDomTextValue()) {
      state.editingPostId = null;
      state.editingGroupId = null;
      state.editingPostRecord = null;
      state.editorDraftSnapshot = captureEditorSnapshot();
      return true;
    }

    try {
      var rawJson = window.sessionStorage.getItem(EDITOR_SNAPSHOT_STORAGE_KEY);
      if (!rawJson) return false;
      var parsed = JSON.parse(rawJson);
      if (!parsed || typeof parsed !== 'object') return false;

      // Never let a snapshot for a previously edited database record repopulate the Create Post form
      if (parsed.editingPostId) {
        window.sessionStorage.removeItem(EDITOR_SNAPSHOT_STORAGE_KEY);
        return false;
      }

      var hasFaqDraft = Array.isArray(parsed.faqs) && parsed.faqs.some(function (f) {
        return f && ((f.question && String(f.question).trim()) || (f.answer && String(f.answer).trim()));
      });

      var hasSavedNewPostDraft =
        Boolean(parsed.languageTouched) ||
        hasFaqDraft ||
        Boolean(
          (parsed.title && String(parsed.title).trim()) ||
            (parsed.slug && String(parsed.slug).trim()) ||
            (parsed.author_name && String(parsed.author_name).trim()) ||
            (parsed.excerpt && String(parsed.excerpt).trim()) ||
            (parsed.content && String(parsed.content).trim()) ||
            (parsed.seo_title && String(parsed.seo_title).trim()) ||
            (parsed.meta_description && String(parsed.meta_description).trim()) ||
            (parsed.featured_image_url && String(parsed.featured_image_url).trim()) ||
            (parsed.featured_image_alt && String(parsed.featured_image_alt).trim())
        );

      if (!hasSavedNewPostDraft) {
        return false;
      }

      parsed.editingPostId = null;
      parsed.editingGroupId = null;
      state.editingPostId = null;
      state.editingGroupId = null;
      state.editingPostRecord = null;
      state.editorDraftSnapshot = parsed;
      applyEditorSnapshotToDom(parsed);

      if (editorModeLabel) {
        editorModeLabel.textContent = 'Create New Post';
      }
      if (editorHeading) {
        editorHeading.textContent = 'Create New Blog Post';
      }
      renderEditorRecordMetadata(null);
      updateActionButtonsState();

      return true;
    } catch (_err) {
      return false;
    }
  }

  function findDuplicateSlugConflict(language, slug, currentPostId) {
    if (!slug) return null;
    var normalizedSlug = slug.toLowerCase();
    for (var i = 0; i < state.posts.length; i++) {
      var post = state.posts[i];
      if (
        post.language === language &&
        String(post.slug || '').toLowerCase() === normalizedSlug &&
        post.id !== currentPostId
      ) {
        return post;
      }
    }
    return null;
  }

  function checkFormValiditySilent() {
    var vals = getFormValues();
    if (!vals.title) return false;
    if (!vals.slug || !SLUG_REGEX.test(vals.slug)) return false;
    if (vals.author_name && vals.author_name.length > 120) return false;
    if (!vals.excerpt) return false;
    if (!vals.content) return false;
    if (!vals.seo_title) return false;
    if (!vals.meta_description) return false;

    if (vals.featured_image_url) {
      var validUrlPrefix =
        vals.featured_image_url.indexOf('https://') === 0 ||
        vals.featured_image_url.indexOf('http://') === 0 ||
        vals.featured_image_url.indexOf('/') === 0;
      if (!validUrlPrefix) return false;
      if (!vals.featured_image_alt) return false;
    } else if (vals.featured_image_alt) {
      return false;
    }

    if (findFirstIncompleteFaqRowIndex(state.faqs) !== -1) {
      return false;
    }

    if (findDuplicateSlugConflict(vals.language, vals.slug, state.editingPostId)) {
      return false;
    }

    return true;
  }

  function updateActionButtonsState() {
    var isBusy =
      Boolean(state.isSaving) ||
      Boolean(state.deletingPostId) ||
      Boolean(state.isUploadingImage);
    var isValid = checkFormValiditySilent();

    if (btnSaveDraft) {
      btnSaveDraft.disabled = isBusy || !isValid;
    }
    if (btnPublishPost) {
      btnPublishPost.disabled = isBusy || !isValid;
    }
    if (btnPreviewPost) {
      btnPreviewPost.disabled = isBusy;
    }
    if (btnResetForm) {
      btnResetForm.disabled = isBusy;
    }
    if (btnAddFaq) {
      btnAddFaq.disabled = isBusy;
    }
    if (inputImageFile) {
      inputImageFile.disabled = isBusy;
    }
    if (btnUploadImage) {
      btnUploadImage.disabled = isBusy || !state.selectedImageFile;
    }
    if (btnUploadImageLabel) {
      btnUploadImageLabel.textContent = state.isUploadingImage
        ? 'Uploading…'
        : 'Upload Image';
    }
    if (btnClearImage) {
      btnClearImage.disabled = isBusy;
    }

    if (btnSaveDraftLabel) {
      if (state.isSaving === 'draft') {
        btnSaveDraftLabel.textContent = 'Saving Draft…';
      } else {
        btnSaveDraftLabel.textContent = 'Save as Draft';
      }
    }

    if (btnPublishPostLabel) {
      if (state.isSaving === 'published') {
        btnPublishPostLabel.textContent = 'Publishing…';
      } else if (
        state.editingPostId &&
        state.editingPostRecord &&
        String(state.editingPostRecord.status).toLowerCase() === 'published'
      ) {
        btnPublishPostLabel.textContent = 'Update Published Post';
      } else {
        btnPublishPostLabel.textContent = 'Publish Post';
      }
    }

    if (editorActionHint) {
      if (state.isUploadingImage) {
        editorActionHint.textContent =
          'Uploading featured image to Supabase Storage (blog-images/featured/)…';
      } else if (isBusy) {
        editorActionHint.textContent =
          state.isSaving === 'published'
            ? 'Sending publish request to Supabase…'
            : 'Saving draft to Supabase…';
      } else if (!isValid) {
        editorActionHint.textContent =
          'Complete all required fields (*) with a valid, unique URL slug (and complete any added FAQ rows) to enable Save Draft and Publish.';
      } else if (state.editingPostId) {
        editorActionHint.textContent =
          'Ready to update existing record (' + shortUuid(state.editingPostId) + ') in public.blog_posts.';
      } else {
        editorActionHint.textContent =
          'Ready to create a new post group and blog post in Supabase.';
      }
    }
  }

  function updateCounters() {
    if (inputAuthorName && authorNameCharCount) {
      var auLen = inputAuthorName.value.trim().length;
      authorNameCharCount.textContent = auLen + ' / 120 chars';
    }
    if (inputExcerpt && excerptCharCount) {
      var exLen = inputExcerpt.value.trim().length;
      excerptCharCount.textContent = exLen + ' / 240 chars';
    }
    if (inputContent && contentWordCount) {
      var words = inputContent.value.trim()
        ? inputContent.value.trim().split(/\s+/).length
        : 0;
      contentWordCount.textContent = words + (words === 1 ? ' word' : ' words');
    }
    if (inputSeoTitle && seoTitleCharCount) {
      var stLen = inputSeoTitle.value.trim().length;
      seoTitleCharCount.textContent = stLen + ' / 60 chars recommended';
      seoTitleCharCount.className =
        stLen > 65
          ? 'text-xs text-amber-700 font-semibold tabular-nums'
          : 'text-xs text-slate-500 tabular-nums';
    }
    if (inputMetaDesc && metaDescCharCount) {
      var mdLen = inputMetaDesc.value.trim().length;
      metaDescCharCount.textContent = mdLen + ' / 160 chars recommended';
      metaDescCharCount.className =
        mdLen > 165
          ? 'text-xs text-amber-700 font-semibold tabular-nums'
          : 'text-xs text-slate-500 tabular-nums';
    }
    updateActionButtonsState();
  }

  function updateMetrics(languageFilter) {
    var activeLang = languageFilter || (globalLangFilter ? globalLangFilter.value : 'all');
    var filteredByLang = state.posts.filter(function (post) {
      return activeLang === 'all' || post.language === activeLang;
    });

    var publishedCount = filteredByLang.filter(function (p) {
      return p.status === 'published';
    }).length;
    var draftCount = filteredByLang.filter(function (p) {
      return p.status === 'draft';
    }).length;

    var enCount = state.posts.filter(function (p) {
      return p.language === 'en';
    }).length;
    var tlCount = state.posts.filter(function (p) {
      return p.language === 'tl';
    }).length;

    if (metricTotalEl) metricTotalEl.textContent = String(filteredByLang.length);
    if (metricPublishedEl) metricPublishedEl.textContent = String(publishedCount);
    if (metricDraftEl) metricDraftEl.textContent = String(draftCount);

    if (metricTotalSubEl) {
      if (activeLang === 'en') {
        metricTotalSubEl.textContent = 'Filtered: English (' + enCount + ' total)';
      } else if (activeLang === 'tl') {
        metricTotalSubEl.textContent = 'Filtered: Filipino (' + tlCount + ' total)';
      } else {
        metricTotalSubEl.textContent = enCount + ' English, ' + tlCount + ' Filipino';
      }
    }

    renderRecentPosts();
  }

  function renderRecentPosts() {
    if (!dashboardRecentPostsBody) return;

    if ((state.isLoadingPosts && !state.hasLoadedOnce) || (!state.hasLoadedOnce && !state.fetchError)) {
      dashboardRecentPostsBody.innerHTML =
        '<div class="p-6 text-center text-sm text-slate-500">Loading recent posts…</div>';
      return;
    }

    if (state.fetchError && state.posts.length === 0) {
      dashboardRecentPostsBody.innerHTML =
        '<div class="p-6 text-center text-sm text-red-700">Could not load recent posts: ' +
        escapeHtml(state.fetchError) +
        '</div>';
      return;
    }

    if (state.posts.length === 0) {
      dashboardRecentPostsBody.innerHTML =
        '<div class="p-6 text-center">' +
        '<p class="text-sm font-semibold text-slate-800">No blog posts yet</p>' +
        '<p class="text-xs text-slate-500 mt-1">Click <strong>Create New Post</strong> above to write your first draft or published article.</p>' +
        '</div>';
      return;
    }

    var recentSlice = state.posts.slice(0, 5);
    var anyRowOperationBusy =
      Boolean(state.isSaving) ||
      Boolean(state.publishingRowId) ||
      Boolean(state.deletingPostId);

    dashboardRecentPostsBody.innerHTML = recentSlice
      .map(function (post) {
        var isTl = post.language === 'tl';
        var urlPrefix = isTl ? '/tl/blog/' : '/blog/';
        var langLabel = isTl ? 'Filipino (TL)' : 'English (EN)';
        var isPublished = String(post.status || '').toLowerCase() === 'published';
        var statusText = isPublished ? 'Published' : 'Draft';
        var statusColor = isPublished ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold';

        return (
          '<div class="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50/80 transition-colors">' +
          '<div class="min-w-0">' +
          '<p class="font-semibold text-slate-900 truncate">' +
          escapeHtml(post.title) +
          '</p>' +
          '<p class="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">' +
          '<span class="' + statusColor + '">' + statusText + '</span>' +
          '<span aria-hidden="true">&middot;</span>' +
          '<span>' + escapeHtml(langLabel) + '</span>' +
          '<span aria-hidden="true">&middot;</span>' +
          '<span class="font-mono">' + escapeHtml(urlPrefix + post.slug + '/') + '</span>' +
          '<span aria-hidden="true">&middot;</span>' +
          '<span>Updated ' + escapeHtml(formatTimestamp(post.updated_at)) + '</span>' +
          '</p>' +
          '</div>' +
          '<div class="flex items-center gap-2 shrink-0">' +
          '<button type="button" data-action="edit-post" data-post-id="' +
          escapeHtml(post.id) +
          '" ' +
          (anyRowOperationBusy ? 'disabled ' : '') +
          'class="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 hover:bg-emerald-50 disabled:bg-slate-100 disabled:text-slate-400 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed">' +
          'Edit in Editor' +
          '</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderTable() {
    if (!tableBody) return;

    if ((state.isLoadingPosts && !state.hasLoadedOnce) || (!state.hasLoadedOnce && !state.fetchError)) {
      if (resultsCountEl) {
        resultsCountEl.textContent = 'Loading posts from Supabase…';
      }
      tableBody.innerHTML =
        '<tr>' +
        '<td colspan="5" class="py-10 px-5 text-center text-sm text-slate-500">' +
        'Loading blog posts from <code class="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">public.blog_posts</code>…' +
        '</td>' +
        '</tr>';
      return;
    }

    if (state.fetchError && state.posts.length === 0) {
      if (resultsCountEl) {
        resultsCountEl.textContent = 'Error loading posts';
      }
      tableBody.innerHTML =
        '<tr>' +
        '<td colspan="5" class="py-10 px-5 text-center text-sm text-red-700">' +
        'Could not load posts from Supabase: ' +
        escapeHtml(state.fetchError) +
        '</td>' +
        '</tr>';
      return;
    }

    var query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var langFilter = tableLangSelect ? tableLangSelect.value : 'all';
    var statusFilter = tableStatusSelect ? tableStatusSelect.value.toLowerCase() : 'all';

    var matching = state.posts.filter(function (post) {
      var postLang = String(post.language || '').toLowerCase();
      var postStatus = String(post.status || '').toLowerCase();
      var matchesLang = langFilter === 'all' || postLang === langFilter;
      var matchesStatus = statusFilter === 'all' || postStatus === statusFilter;
      var matchesQuery =
        !query ||
        String(post.title || '').toLowerCase().indexOf(query) !== -1 ||
        String(post.slug || '').toLowerCase().indexOf(query) !== -1;
      return matchesLang && matchesStatus && matchesQuery;
    });

    if (resultsCountEl) {
      if (state.isLoadingPosts) {
        resultsCountEl.textContent = 'Refreshing posts…';
      } else {
        resultsCountEl.textContent =
          'Showing ' +
          matching.length +
          ' of ' +
          state.posts.length +
          (state.posts.length === 1 ? ' post' : ' posts');
      }
    }

    if (state.posts.length === 0) {
      tableBody.innerHTML =
        '<tr>' +
        '<td colspan="5" class="py-10 px-5 text-center">' +
        '<p class="text-sm font-semibold text-slate-800">No blog posts in Supabase yet</p>' +
        '<p class="text-xs text-slate-500 mt-1">Use the Create New Blog Post editor below to save a draft or publish your first article.</p>' +
        '</td>' +
        '</tr>';
      return;
    }

    if (matching.length === 0) {
      tableBody.innerHTML =
        '<tr>' +
        '<td colspan="5" class="py-8 px-5 text-center text-sm text-slate-500">' +
        'No database posts match your current search or language/status filters.' +
        '</td>' +
        '</tr>';
      return;
    }

    var rowsHtml = matching
      .map(function (post) {
        var isTl = post.language === 'tl';
        var urlPrefix = isTl ? '/tl/blog/' : '/blog/';
        var langLabel = isTl ? 'Filipino' : 'English';
        var postStatusLower = String(post.status || '').toLowerCase();
        var isPublished = postStatusLower === 'published';
        var isDraft = postStatusLower === 'draft';
        var isRealDatabasePost = isValidUuid(post.id) && (isDraft || isPublished);
        var isEditingThis = state.editingPostId === post.id;
        var isPublishingThisRow = state.publishingRowId === post.id;
        var isDeletingThisRow = state.deletingPostId === post.id;
        var anyRowOperationBusy =
          Boolean(state.isSaving) ||
          Boolean(state.publishingRowId) ||
          Boolean(state.deletingPostId);

        var statusBadgeHtml = isPublished
          ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">Published</span>'
          : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">Draft</span>';

        var publishedMetaHtml =
          isPublished && post.published_at
            ? '<span class="block text-[11px] text-slate-500 mt-1">Published: ' +
              escapeHtml(formatTimestamp(post.published_at)) +
              '</span>'
            : '<span class="block text-[11px] text-slate-400 mt-1">Not published</span>';

        var rowHighlightClass = isEditingThis
          ? 'bg-emerald-50/50 hover:bg-emerald-50/80 transition-colors'
          : 'hover:bg-slate-50/80 transition-colors';

        var publishActionBtnHtml = !isPublished
          ? '<button type="button" data-action="publish-row" data-post-id="' +
            escapeHtml(post.id) +
            '" ' +
            (anyRowOperationBusy ? 'disabled ' : '') +
            'class="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed">' +
            (isPublishingThisRow ? 'Publishing…' : 'Publish') +
            '</button>'
          : '<span class="text-xs font-medium text-emerald-700 px-2 py-1">Live</span>';

        var deleteActionBtnHtml = isRealDatabasePost
          ? '<button type="button" data-action="delete-post" data-post-id="' +
            escapeHtml(post.id) +
            '" ' +
            (anyRowOperationBusy ? 'disabled ' : '') +
            'class="text-xs font-semibold text-red-700 hover:text-red-800 bg-white hover:bg-red-50 border border-red-200 hover:border-red-300 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed">' +
            (isDeletingThisRow ? 'Deleting…' : 'Delete') +
            '</button>'
          : '';

        return (
          '<tr class="' +
          rowHighlightClass +
          '">' +
          '<td class="py-4 pl-5 pr-3 align-top">' +
          '<div class="font-semibold text-slate-900 flex flex-wrap items-center gap-1.5">' +
          '<span>' +
          escapeHtml(post.title) +
          '</span>' +
          (isEditingThis
            ? '<span class="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">Editing</span>'
            : '') +
          '</div>' +
          '<div class="text-xs font-mono text-slate-500 mt-0.5">' +
          escapeHtml(urlPrefix + post.slug + '/') +
          '</div>' +
          '</td>' +
          '<td class="py-4 px-3 align-top text-slate-700 font-medium whitespace-nowrap">' +
          escapeHtml(langLabel) +
          ' <span class="text-xs text-slate-400 font-mono">(' +
          escapeHtml(String(post.language || '').toUpperCase()) +
          ')</span>' +
          '</td>' +
          '<td class="py-4 px-3 align-top whitespace-nowrap">' +
          statusBadgeHtml +
          publishedMetaHtml +
          '</td>' +
          '<td class="py-4 px-3 align-top text-slate-600 whitespace-nowrap text-xs font-mono">' +
          escapeHtml(formatTimestamp(post.updated_at)) +
          '</td>' +
          '<td class="py-4 pl-3 pr-5 align-top text-right whitespace-nowrap">' +
          '<div class="inline-flex items-center gap-2">' +
          '<button type="button" data-action="edit-post" data-post-id="' +
          escapeHtml(post.id) +
          '" ' +
          (anyRowOperationBusy ? 'disabled ' : '') +
          'class="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 hover:bg-emerald-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed">' +
          'Edit in Editor' +
          '</button>' +
          publishActionBtnHtml +
          deleteActionBtnHtml +
          '</div>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    tableBody.innerHTML = rowsHtml;
  }

  async function loadPostsFromSupabase() {
    var bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (!bridge || !bridge.isAdminVerified()) {
      return;
    }

    state.isLoadingPosts = true;
    state.fetchError = null;
    if (tableErrorBanner) {
      tableErrorBanner.classList.add('hidden');
    }
    if (btnRefreshPosts) {
      btnRefreshPosts.disabled = true;
      btnRefreshPosts.textContent = 'Refreshing…';
    }
    renderTable();

    try {
      var result = await bridge.fetchPosts();

      if (result.status === 'unauthorized') {
        state.posts = [];
        state.hasLoadedOnce = false;
        updateMetrics();
        renderTable();
        return;
      }

      if (result.status === 'error') {
        state.fetchError = result.message || 'Failed to load blog posts.';
        if (tableErrorBanner && tableErrorMessage) {
          tableErrorMessage.textContent = state.fetchError;
          tableErrorBanner.classList.remove('hidden');
        }
        renderTable();
        return;
      }

      state.posts = Array.isArray(result.posts) ? result.posts : [];
      state.hasLoadedOnce = true;
      state.fetchError = null;

      // Keep editingPostRecord synchronized if the currently edited post is in the refreshed list
      if (state.editingPostId) {
        var refreshedRecord = state.posts.find(function (p) {
          return p.id === state.editingPostId;
        });
        if (refreshedRecord) {
          state.editingPostRecord = refreshedRecord;
          state.editingGroupId = refreshedRecord.group_id;
          syncEditorHeaderForRecord(refreshedRecord);
        }
      }

      updateMetrics();
      renderTable();
      updateActionButtonsState();
      updateActiveEditorSessionBanner();
    } catch (err) {
      state.fetchError =
        err && err.message ? err.message : 'Unexpected error while loading posts.';
      if (tableErrorBanner && tableErrorMessage) {
        tableErrorMessage.textContent = state.fetchError;
        tableErrorBanner.classList.remove('hidden');
      }
      renderRecentPosts();
      renderTable();
    } finally {
      state.isLoadingPosts = false;
      if (btnRefreshPosts) {
        btnRefreshPosts.disabled = false;
        btnRefreshPosts.textContent = 'Refresh Posts';
      }
      renderRecentPosts();
      renderTable();
    }
  }

  function syncEditorHeaderForRecord(post) {
    if (!post || !post.id) {
      if (editorModeLabel) {
        editorModeLabel.textContent = 'Create New Post';
      }
      if (editorHeading) {
        editorHeading.textContent = 'Create New Blog Post';
      }
      renderEditorRecordMetadata(null);
      return;
    }

    var isPublished = String(post.status || '').toLowerCase() === 'published';
    if (editorModeLabel) {
      editorModeLabel.textContent = isPublished
        ? 'Editing Published Post'
        : 'Editing Draft Post';
    }
    if (editorHeading) {
      editorHeading.textContent = 'Edit Post: ' + post.title;
    }
    renderEditorRecordMetadata(post);
  }

  function updateActiveEditorSessionBanner() {
    if (!activeEditorSessionBanner || !activeEditorSessionText) return;

    if (state.activeView === 'create-post') {
      activeEditorSessionBanner.classList.add('hidden');
      return;
    }

    var hasUnsaved = hasUnsavedEditorChanges();
    if (!state.editingPostId && !hasUnsaved) {
      activeEditorSessionBanner.classList.add('hidden');
      return;
    }

    var raw = getRawEditorValues();
    var titleDisplay = raw.title.trim() ? '"' + raw.title.trim() + '"' : '(Untitled draft)';
    if (state.editingPostId) {
      var statusLabel =
        state.editingPostRecord && String(state.editingPostRecord.status).toLowerCase() === 'published'
          ? 'Published post'
          : 'Draft post';
      activeEditorSessionText.textContent =
        statusLabel +
        ' ' +
        titleDisplay +
        (hasUnsaved ? ' has unsaved edits in the editor.' : ' is currently loaded in the editor.');
    } else {
      activeEditorSessionText.textContent =
        'Unsaved new post ' + titleDisplay + ' (' + raw.language.toUpperCase() + ') is in progress.';
    }

    activeEditorSessionBanner.classList.remove('hidden');
  }

  function highlightNavButton(activeTarget) {
    navButtons.forEach(function (btn) {
      var btnTarget = btn.getAttribute('data-nav-target');
      if (btnTarget === activeTarget) {
        btn.setAttribute('aria-current', 'page');
        btn.className =
          'admin-nav-btn px-3 py-1.5 rounded-md text-sm font-semibold transition-colors bg-white text-emerald-700 shadow-xs whitespace-nowrap shrink-0';
      } else {
        btn.removeAttribute('aria-current');
        btn.className =
          'admin-nav-btn px-3 py-1.5 rounded-md text-sm font-medium transition-colors text-slate-700 hover:text-slate-900 hover:bg-white/60 whitespace-nowrap shrink-0';
      }
    });
  }

  function showEditorView(options) {
    var opts = options || {};
    state.activeView = 'create-post';
    highlightNavButton('create-post');

    if (sectionDashboard) sectionDashboard.classList.add('hidden');
    if (sectionPostsTable) sectionPostsTable.classList.add('hidden');
    if (sectionAnnouncementAdmin) sectionAnnouncementAdmin.classList.add('hidden');
    if (sectionPostEditor) sectionPostEditor.classList.remove('hidden');
    if (activeEditorSessionBanner) activeEditorSessionBanner.classList.add('hidden');

    if (state.editorDraftSnapshot) {
      applyEditorSnapshotToDom(state.editorDraftSnapshot);
    }

    if (state.editingPostId && state.editingPostRecord) {
      syncEditorHeaderForRecord(state.editingPostRecord);
    } else if (!state.editingPostId) {
      syncEditorHeaderForRecord(null);
    }

    updateActionButtonsState();

    if (!opts.preserveScroll && sectionPostEditor) {
      sectionPostEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (inputTitle) inputTitle.focus();
    }
  }

  function setActiveNav(targetView) {
    // Capture current editor fields before switching views; never reset or clear the form on All Posts / Dashboard
    saveEditorSnapshot();

    if (!sectionDashboard || !sectionPostsTable || !sectionPostEditor) return;

    if (sectionAnnouncementAdmin) {
      if (targetView === 'announcement') {
        sectionAnnouncementAdmin.classList.remove('hidden');
      } else {
        sectionAnnouncementAdmin.classList.add('hidden');
      }
    }

    if (targetView === 'dashboard') {
      state.activeView = 'dashboard';
      highlightNavButton('dashboard');
      sectionDashboard.classList.remove('hidden');
      sectionPostsTable.classList.add('hidden');
      sectionPostEditor.classList.add('hidden');
      if (sectionPostPreview) sectionPostPreview.classList.add('hidden');
      updateMetrics();
      updateActiveEditorSessionBanner();
    } else if (targetView === 'all-posts') {
      state.activeView = 'all-posts';
      highlightNavButton('all-posts');
      sectionDashboard.classList.add('hidden');
      sectionPostsTable.classList.remove('hidden');
      sectionPostEditor.classList.add('hidden');
      if (sectionPostPreview) sectionPostPreview.classList.add('hidden');
      renderTable();
      updateActiveEditorSessionBanner();
      sectionPostsTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (targetView === 'create-post') {
      state.activeView = 'create-post';
      highlightNavButton('create-post');
      sectionDashboard.classList.add('hidden');
      sectionPostsTable.classList.add('hidden');
      sectionPostEditor.classList.remove('hidden');
      if (activeEditorSessionBanner) activeEditorSessionBanner.classList.add('hidden');

      // Ensure Create Post view is strictly in new-post mode (never retaining a previous database record)
      if (state.editingPostId) {
        clearEditorSnapshot();
        resetEditorForm();
      } else {
        state.editingPostId = null;
        state.editingGroupId = null;
        state.editingPostRecord = null;
        if (state.editorDraftSnapshot && !state.editorDraftSnapshot.editingPostId) {
          applyEditorSnapshotToDom(state.editorDraftSnapshot);
        }
        syncEditorHeaderForRecord(null);
        updateActionButtonsState();
      }

      sectionPostEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (inputTitle) inputTitle.focus();
    } else if (targetView === 'announcement') {
      state.activeView = 'announcement';
      highlightNavButton('announcement');
      sectionDashboard.classList.add('hidden');
      sectionPostsTable.classList.add('hidden');
      sectionPostEditor.classList.add('hidden');
      if (sectionPostPreview) sectionPostPreview.classList.add('hidden');
      updateActiveEditorSessionBanner();
      if (!state.announcementHasLoaded) {
        void loadAnnouncementFromSupabase();
      }
      if (sectionAnnouncementAdmin) {
        sectionAnnouncementAdmin.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  function requestCreatePostMode() {
    // If a saved database record is currently loaded in the editor, ask before discarding current editing state
    if (state.editingPostId) {
      var hasEdits = hasUnsavedEditorChanges();
      openUnsavedChangesModal(
        'Discard current editing state and start a new blank post (Create New Post mode)',
        function () {
          clearEditorSnapshot();
          resetEditorForm();
          setActiveNav('create-post');
        },
        {
          title: hasEdits
            ? 'Discard Unsaved Edits & Start New Post?'
            : 'Leave Current Post & Start New Post?',
          description: hasEdits
            ? 'You are currently editing an existing database post with unsaved changes. Starting a new post will discard your unsaved edits and reset the editor to Create New Post mode.'
            : 'An existing database post is currently loaded in the editor. Switching to Create Post will clear the loaded record from the editor and open a blank new-post form.'
        }
      );
      return;
    }

    // Already in new-post mode: preserve any unsaved new-post fields and open Create Post view
    setActiveNav('create-post');
  }

  function clearFieldErrors() {
    var errorIds = [
      'post-title-error',
      'post-slug-error',
      'post-author-name-error',
      'post-excerpt-error',
      'post-content-error',
      'post-seo-title-error',
      'post-meta-description-error',
      'post-image-url-error',
      'post-image-alt-error',
      'post-faqs-error'
    ];
    errorIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.textContent = '';
        el.classList.add('hidden');
      }
    });

    var inputs = [
      inputTitle,
      inputSlug,
      inputAuthorName,
      inputExcerpt,
      inputContent,
      inputSeoTitle,
      inputMetaDesc,
      inputImageUrl,
      inputImageAlt
    ];
    inputs.forEach(function (input) {
      if (input) {
        input.removeAttribute('aria-invalid');
        input.classList.remove('border-red-500');
      }
    });

    if (validationSummary) validationSummary.classList.add('hidden');
    if (validationList) validationList.innerHTML = '';
    if (validationSuccess) validationSuccess.classList.add('hidden');
  }

  function setFieldError(inputEl, errorElId, message) {
    var errorEl = document.getElementById(errorElId);
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
    if (inputEl) {
      inputEl.setAttribute('aria-invalid', 'true');
      inputEl.classList.add('border-red-500');
    }
  }

  function validateForm(options) {
    var opts = options || {};
    clearFieldErrors();
    var errors = [];
    var vals = getFormValues();

    if (!vals.title) {
      var msgTitle = 'Post Title is required.';
      errors.push(msgTitle);
      setFieldError(inputTitle, 'post-title-error', msgTitle);
    }

    if (!vals.slug) {
      var msgSlugReq = 'URL Slug is required.';
      errors.push(msgSlugReq);
      setFieldError(inputSlug, 'post-slug-error', msgSlugReq);
    } else if (!SLUG_REGEX.test(vals.slug)) {
      var msgSlugFmt =
        'URL Slug must contain only lowercase letters, numbers, and single hyphens (e.g., 13th-month-pay-guide).';
      errors.push(msgSlugFmt);
      setFieldError(inputSlug, 'post-slug-error', msgSlugFmt);
    } else {
      var duplicateConflict = findDuplicateSlugConflict(
        vals.language,
        vals.slug,
        state.editingPostId
      );
      if (duplicateConflict) {
        var msgSlugDup =
          'Another ' +
          (vals.language === 'tl' ? 'Filipino' : 'English') +
          ' post ("' +
          duplicateConflict.title +
          '") already uses the slug "' +
          vals.slug +
          '". Please choose a unique URL slug.';
        errors.push(msgSlugDup);
        setFieldError(inputSlug, 'post-slug-error', msgSlugDup);
      }
    }

    if (vals.author_name && vals.author_name.length > 120) {
      var msgAuthorLen = 'Author Name must be 120 characters or fewer.';
      errors.push(msgAuthorLen);
      setFieldError(inputAuthorName, 'post-author-name-error', msgAuthorLen);
    }

    if (!vals.excerpt) {
      var msgExcerpt = 'Short Excerpt is required.';
      errors.push(msgExcerpt);
      setFieldError(inputExcerpt, 'post-excerpt-error', msgExcerpt);
    }

    if (!vals.content) {
      var msgContent = 'Article Content is required.';
      errors.push(msgContent);
      setFieldError(inputContent, 'post-content-error', msgContent);
    }

    if (!vals.seo_title) {
      var msgSeoTitle = 'SEO Title is required.';
      errors.push(msgSeoTitle);
      setFieldError(inputSeoTitle, 'post-seo-title-error', msgSeoTitle);
    }

    if (!vals.meta_description) {
      var msgMetaDesc = 'Meta Description is required.';
      errors.push(msgMetaDesc);
      setFieldError(inputMetaDesc, 'post-meta-description-error', msgMetaDesc);
    }

    if (vals.featured_image_url) {
      var isValidUrl =
        vals.featured_image_url.indexOf('https://') === 0 ||
        vals.featured_image_url.indexOf('http://') === 0 ||
        vals.featured_image_url.indexOf('/') === 0;
      if (!isValidUrl) {
        var msgImgUrl = 'Featured Image URL must start with https://, http://, or /.';
        errors.push(msgImgUrl);
        setFieldError(inputImageUrl, 'post-image-url-error', msgImgUrl);
      }
      if (!vals.featured_image_alt) {
        var msgImgAlt =
          'Featured Image Alt Text is required when a Featured Image URL is provided.';
        errors.push(msgImgAlt);
        setFieldError(inputImageAlt, 'post-image-alt-error', msgImgAlt);
      }
    } else if (vals.featured_image_alt) {
      var msgUrlMissing =
        'Featured Image URL is required when Featured Image Alt Text is provided (or clear the Alt Text field).';
      errors.push(msgUrlMissing);
      setFieldError(inputImageUrl, 'post-image-url-error', msgUrlMissing);
    }

    var incompleteFaqIdx = findFirstIncompleteFaqRowIndex(state.faqs);
    if (incompleteFaqIdx !== -1) {
      var msgFaq =
        'FAQ #' +
        (incompleteFaqIdx + 1) +
        ' must have both a Question and an Answer (or click Remove on that FAQ item).';
      errors.push(msgFaq);
      setFieldError(null, 'post-faqs-error', msgFaq);
    }

    updateActionButtonsState();

    if (errors.length > 0) {
      if (validationSummary && validationList) {
        validationList.innerHTML = errors
          .map(function (err) {
            return '<li>' + escapeHtml(err) + '</li>';
          })
          .join('');
        validationSummary.classList.remove('hidden');
        validationSummary.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (sectionPostPreview) {
        sectionPostPreview.classList.add('hidden');
      }
      return false;
    }

    if (!opts.silentSuccessBanner && validationSuccess) {
      validationSuccess.classList.remove('hidden');
    }
    return true;
  }


  function renderPreview() {
    renderCrudFeedback(null);
    if (!validateForm({ silentSuccessBanner: false })) return;

    var vals = getFormValues();
    var fullUrl =
      vals.language === 'tl'
        ? 'https://suweldotools.com/tl/blog/' + vals.slug + '/'
        : 'https://suweldotools.com/blog/' + vals.slug + '/';

    var serpUrlEl = document.getElementById('preview-serp-url');
    var serpTitleEl = document.getElementById('preview-serp-title');
    var serpDescEl = document.getElementById('preview-serp-description');
    var artLangEl = document.getElementById('preview-article-lang');
    var artAuthorEl = document.getElementById('preview-article-author');
    var artTitleEl = document.getElementById('preview-article-title');
    var artExcerptEl = document.getElementById('preview-article-excerpt');
    var artContentEl = document.getElementById('preview-article-content');
    var artFaqsEl = document.getElementById('preview-article-faqs');
    var imgContainerEl = document.getElementById('preview-image-container');
    var imgPreviewEl = document.getElementById('preview-image-element');
    var imgUrlTextEl = document.getElementById('preview-image-url-text');
    var imgAltTextEl = document.getElementById('preview-image-alt-text');

    if (serpUrlEl) serpUrlEl.textContent = fullUrl;
    if (serpTitleEl) serpTitleEl.textContent = vals.seo_title;
    if (serpDescEl) serpDescEl.textContent = vals.meta_description;
    if (artLangEl) {
      artLangEl.textContent =
        vals.language === 'tl' ? 'Filipino (tl-PH)' : 'English (en-PH)';
    }
    if (artAuthorEl) {
      var authorDisplay = vals.author_name || 'SuweldoTools';
      artAuthorEl.textContent =
        vals.language === 'tl' ? 'Ni ' + authorDisplay : 'By ' + authorDisplay;
    }
    if (artTitleEl) artTitleEl.textContent = vals.title;
    if (artExcerptEl) artExcerptEl.textContent = vals.excerpt;

    if (imgContainerEl && imgUrlTextEl && imgAltTextEl) {
      if (vals.featured_image_url) {
        imgUrlTextEl.textContent = vals.featured_image_url;
        imgAltTextEl.textContent = vals.featured_image_alt;
        if (imgPreviewEl) {
          imgPreviewEl.src = vals.featured_image_url;
          imgPreviewEl.alt = vals.featured_image_alt || vals.title || 'Featured image preview';
          imgPreviewEl.classList.remove('hidden');
        }
        imgContainerEl.classList.remove('hidden');
      } else {
        if (imgPreviewEl) {
          imgPreviewEl.removeAttribute('src');
          imgPreviewEl.classList.add('hidden');
        }
        imgContainerEl.classList.add('hidden');
      }
    }

    if (artContentEl) {
      artContentEl.innerHTML = renderSafeAdminArticleContent(vals.content);
    }

    if (artFaqsEl) {
      if (Array.isArray(vals.faqs) && vals.faqs.length > 0) {
        var faqHeading =
          vals.language === 'tl'
            ? 'Mga Madalas Itanong (FAQ)'
            : 'Frequently Asked Questions (FAQs)';
        artFaqsEl.innerHTML =
          '<h4 class="text-lg font-bold text-slate-900">' +
          escapeHtml(faqHeading) +
          '</h4>' +
          '<div class="space-y-2.5">' +
          vals.faqs
            .map(function (item) {
              return (
                '<details class="group rounded-xl border border-slate-200 bg-slate-50/70 open:bg-white p-3.5">' +
                '<summary class="cursor-pointer font-semibold text-sm text-slate-900">' +
                escapeHtml(item.question) +
                '</summary>' +
                '<p class="mt-2 text-sm text-slate-600 leading-relaxed whitespace-pre-line">' +
                escapeHtml(item.answer) +
                '</p>' +
                '</details>'
              );
            })
            .join('') +
          '</div>';
        artFaqsEl.classList.remove('hidden');
      } else {
        artFaqsEl.innerHTML = '';
        artFaqsEl.classList.add('hidden');
      }
    }

    if (sectionPostPreview) {
      sectionPostPreview.classList.remove('hidden');
      sectionPostPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderEditorRecordMetadata(post) {
    if (!editorRecordMeta) return;
    if (!post || !post.id) {
      editorRecordMeta.classList.add('hidden');
      return;
    }

    editorRecordMeta.classList.remove('hidden');
    if (editorRecordId) editorRecordId.textContent = post.id;
    if (editorRecordGroupId) editorRecordGroupId.textContent = post.group_id;

    var isPublished = String(post.status).toLowerCase() === 'published';
    if (editorRecordStatusBadge) {
      editorRecordStatusBadge.textContent = isPublished
        ? 'Current Status: Published'
        : 'Current Status: Draft';
      editorRecordStatusBadge.className = isPublished
        ? 'inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200'
        : 'inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200';
    }

    if (editorRecordTimestamps) {
      var tsParts = ['Updated: ' + formatTimestamp(post.updated_at)];
      if (isPublished && post.published_at) {
        tsParts.push('Published: ' + formatTimestamp(post.published_at));
      }
      editorRecordTimestamps.textContent = tsParts.join(' · ');
    }
  }

  function loadDatabasePostIntoEditor(post, options) {
    if (!post) return;
    var opts = options || {};

    clearFieldErrors();
    if (!opts.keepCrudBanner) {
      renderCrudFeedback(null);
    }

    state.editingPostId = post.id;
    state.editingGroupId = post.group_id;
    state.editingPostRecord = post;
    state.languageTouched = false;

    if (inputLanguage) inputLanguage.value = post.language === 'tl' ? 'tl' : 'en';
    if (inputTitle) inputTitle.value = post.title || '';
    if (inputSlug) inputSlug.value = post.slug || '';
    if (inputAuthorName) inputAuthorName.value = post.author_name || '';
    if (inputExcerpt) inputExcerpt.value = post.excerpt || '';
    if (inputContent) inputContent.value = post.content || '';
    if (inputSeoTitle) inputSeoTitle.value = post.seo_title || '';
    if (inputMetaDesc) inputMetaDesc.value = post.meta_description || '';
    if (inputImageUrl) inputImageUrl.value = post.featured_image_url || '';
    if (inputImageAlt) inputImageAlt.value = post.featured_image_alt || '';
    state.faqs = normalizeFaqArray(post.faqs);
    renderFaqRepeater();

    clearSelectedImageFileSelection(false);
    syncEditorHeaderForRecord(post);
    updateSlugPrefix();
    updateEditorImagePreview();
    updateCounters();
    saveEditorSnapshot();
    renderRecentPosts();
    renderTable();

    showEditorView({ preserveScroll: opts.preserveScroll });
  }

  function resetEditorForm(options) {
    var opts = options || {};
    state.editingPostId = null;
    state.editingGroupId = null;
    state.editingPostRecord = null;
    state.languageTouched = false;
    state.faqs = [];

    clearSelectedImageFileSelection(false);
    if (form) form.reset();
    if (inputTitle) inputTitle.value = '';
    if (inputSlug) inputSlug.value = '';
    if (inputAuthorName) inputAuthorName.value = '';
    if (inputExcerpt) inputExcerpt.value = '';
    if (inputContent) inputContent.value = '';
    if (inputSeoTitle) inputSeoTitle.value = '';
    if (inputMetaDesc) inputMetaDesc.value = '';
    if (inputImageUrl) inputImageUrl.value = '';
    if (inputImageAlt) inputImageAlt.value = '';
    renderFaqRepeater();

    if (
      inputLanguage &&
      globalLangFilter &&
      (globalLangFilter.value === 'en' || globalLangFilter.value === 'tl')
    ) {
      inputLanguage.value = globalLangFilter.value;
    } else if (inputLanguage) {
      inputLanguage.value = 'en';
    }

    clearFieldErrors();
    if (!opts.keepCrudBanner) {
      renderCrudFeedback(null);
    }
    syncEditorHeaderForRecord(null);
    if (sectionPostPreview) {
      sectionPostPreview.classList.add('hidden');
    }

    clearEditorSnapshot();
    updateSlugPrefix();
    updateEditorImagePreview();
    updateCounters();
    renderRecentPosts();
    renderTable();
    updateActiveEditorSessionBanner();
  }

  function openUnsavedChangesModal(targetSummaryText, onConfirmCallback, modalOptions) {
    if (!unsavedChangesModal) {
      if (typeof onConfirmCallback === 'function') {
        clearEditorSnapshot();
        onConfirmCallback();
      }
      return;
    }

    var opts = modalOptions || {};
    state.pendingDiscardCallback = onConfirmCallback;

    var raw = getRawEditorValues();
    var currentTitleText = raw.title.trim() ? '"' + raw.title.trim() + '"' : '(Untitled)';
    var recordStatusText =
      state.editingPostRecord && state.editingPostRecord.status
        ? String(state.editingPostRecord.status).toUpperCase() + ' · '
        : '';
    var currentModeText = state.editingPostId
      ? 'Editing database post ' +
        currentTitleText +
        ' (' +
        recordStatusText +
        shortUuid(state.editingPostId) +
        ')'
      : 'New unsaved post ' + currentTitleText + ' (' + raw.language.toUpperCase() + ')';

    if (unsavedChangesModalTitle) {
      unsavedChangesModalTitle.textContent =
        opts.title || 'Replace Unsaved Blog Post Data?';
    }
    if (unsavedChangesModalDesc) {
      unsavedChangesModalDesc.textContent =
        opts.description ||
        'You have unsaved changes in the Blog Post Editor. Continuing will discard your current editor state unless you save first.';
    }
    if (unsavedModalCurrentSummary) {
      unsavedModalCurrentSummary.textContent = currentModeText;
    }
    if (unsavedModalTargetSummary) {
      unsavedModalTargetSummary.textContent =
        targetSummaryText || 'Discard current unsaved changes';
    }

    unsavedChangesModal.classList.remove('hidden');
    unsavedChangesModal.removeAttribute('aria-hidden');
    if (btnCancelDiscardChanges) {
      btnCancelDiscardChanges.focus();
    }
  }

  function closeUnsavedChangesModal() {
    state.pendingDiscardCallback = null;
    if (unsavedChangesModal) {
      unsavedChangesModal.classList.add('hidden');
      unsavedChangesModal.setAttribute('aria-hidden', 'true');
    }
  }

  function confirmDiscardUnsavedChanges() {
    var cb = state.pendingDiscardCallback;
    closeUnsavedChangesModal();
    clearEditorSnapshot();
    if (typeof cb === 'function') {
      cb();
    }
  }

  async function submitPostWithStatus(targetStatus) {
    if (state.isSaving) return;

    var bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (!bridge || !bridge.isAdminVerified()) {
      renderCrudFeedback(
        'error',
        'Administrator Session Required',
        'You must be signed in as a verified administrator in public.blog_admins to save or publish posts.'
      );
      return;
    }

    renderCrudFeedback(null);

    if (!validateForm({ silentSuccessBanner: true })) {
      return;
    }

    var vals = getFormValues();
    state.isSaving = targetStatus;
    updateActionButtonsState();

    try {
      var payload = {
        id: state.editingPostId,
        group_id: state.editingGroupId,
        language: vals.language,
        title: vals.title,
        slug: vals.slug,
        author_name: vals.author_name ? vals.author_name : null,
        excerpt: vals.excerpt,
        content: vals.content,
        seo_title: vals.seo_title,
        meta_description: vals.meta_description,
        featured_image_url: vals.featured_image_url ? vals.featured_image_url : null,
        featured_image_alt: vals.featured_image_alt ? vals.featured_image_alt : null,
        faqs: vals.faqs,
        status: targetStatus
      };

      var result = await bridge.savePost(payload);

      if (result.status === 'unauthorized') {
        return;
      }

      if (result.status === 'duplicate_slug') {
        setFieldError(inputSlug, 'post-slug-error', result.message);
        renderCrudFeedback('error', 'Duplicate URL Slug', result.message);
        if (inputSlug) inputSlug.focus();
        return;
      }

      if (result.status === 'validation_error') {
        renderCrudFeedback('error', 'Validation Rejected by Database', result.message);
        return;
      }

      if (result.status === 'error' || !result.post) {
        renderCrudFeedback(
          'error',
          targetStatus === 'published' ? 'Publish Failed' : 'Save Draft Failed',
          result.message || 'An unexpected Supabase error occurred.'
        );
        return;
      }

      var savedPost = result.post;
      var actionVerb = result.isNew ? 'Created' : 'Updated';
      var statusLabel = savedPost.status === 'published' ? 'Published' : 'Saved as Draft';
      var publishedTimestampNote =
        savedPost.status === 'published' && savedPost.published_at
          ? ' Published timestamp: ' + formatTimestamp(savedPost.published_at) + '.'
          : '';

      // Clear unsaved-form snapshot upon confirmed save/publish, then synchronize active record
      clearEditorSnapshot();
      loadDatabasePostIntoEditor(savedPost, {
        preserveScroll: true,
        keepCrudBanner: true
      });

      // Refresh full list, metrics, and static blog HTML pages
      var regenResults = await Promise.all([
        loadPostsFromSupabase(),
        triggerStaticBlogRegeneration()
      ]);
      var regenStatus = regenResults[1];

      var saveFeedbackTitle = 'Post ' + actionVerb + ' & ' + statusLabel;
      var saveFeedbackBody =
        '"' +
        savedPost.title +
        '" (' +
        savedPost.language.toUpperCase() +
        ' · /' +
        (savedPost.language === 'tl' ? 'tl/blog/' : 'blog/') +
        savedPost.slug +
        '/) was confirmed by Supabase (ID: ' +
        shortUuid(savedPost.id) +
        ', Group: ' +
        shortUuid(savedPost.group_id) +
        ').' +
        publishedTimestampNote;

      if (targetStatus === 'published') {
        if (regenStatus && regenStatus.ok) {
          saveFeedbackBody += ' Static HTML pages were regenerated.';
          renderCrudFeedback('success', saveFeedbackTitle, saveFeedbackBody);
        } else if (regenStatus && regenStatus.status === 'static_host') {
          saveFeedbackBody += ' Note: On static hosting, published pages will appear on the next deployment build.';
          renderCrudFeedback('warning', saveFeedbackTitle + ' (Static Host Notice)', saveFeedbackBody);
        } else {
          saveFeedbackBody +=
            ' Warning: Static blog regeneration could not complete (' +
            ((regenStatus && regenStatus.message) || 'endpoint unavailable') +
            ').';
          renderCrudFeedback('warning', saveFeedbackTitle + ' (Regeneration Warning)', saveFeedbackBody);
        }
      } else {
        renderCrudFeedback('success', saveFeedbackTitle, saveFeedbackBody);
      }
    } catch (err) {
      var msg =
        err && err.message
          ? err.message
          : 'Network error while communicating with Supabase.';
      renderCrudFeedback(
        'error',
        targetStatus === 'published' ? 'Publish Failed' : 'Save Draft Failed',
        msg
      );
    } finally {
      state.isSaving = null;
      updateActionButtonsState();
    }
  }

  async function publishDraftRowFromTable(postId) {
    if (state.isSaving || state.publishingRowId) return;

    var bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (!bridge || !bridge.isAdminVerified()) return;

    var post = state.posts.find(function (p) {
      return p.id === postId;
    });
    if (!post) return;

    state.publishingRowId = postId;
    renderTable();

    try {
      var result = await bridge.savePost({
        id: post.id,
        group_id: post.group_id,
        language: post.language,
        title: post.title,
        slug: post.slug,
        author_name: post.author_name ? post.author_name : null,
        excerpt: post.excerpt,
        content: post.content,
        seo_title: post.seo_title,
        meta_description: post.meta_description,
        featured_image_url: post.featured_image_url,
        featured_image_alt: post.featured_image_alt,
        faqs: Array.isArray(post.faqs) ? post.faqs : [],
        status: 'published'
      });

      if (result.status === 'unauthorized') {
        return;
      }

      if (result.status !== 'ok' || !result.post) {
        if (!hasUnsavedEditorChanges()) {
          loadDatabasePostIntoEditor(post, { keepCrudBanner: true });
        }
        renderCrudFeedback(
          'error',
          'Could Not Publish Draft',
          result.message || 'Please review the post fields in the editor and try again.'
        );
        return;
      }

      if (state.editingPostId === result.post.id) {
        if (!hasUnsavedEditorChanges()) {
          loadDatabasePostIntoEditor(result.post, {
            preserveScroll: true,
            keepCrudBanner: true
          });
        } else {
          state.editingPostRecord = result.post;
          renderEditorRecordMetadata(result.post);
        }
      }

      var publishMsg =
        '"' +
        result.post.title +
        '" is now published in Supabase (published_at: ' +
        formatTimestamp(result.post.published_at) +
        ').';

      var regenResults = await Promise.all([
        loadPostsFromSupabase(),
        triggerStaticBlogRegeneration()
      ]);
      var regenStatus = regenResults[1];

      if (regenStatus && regenStatus.ok) {
        publishMsg += ' Static HTML pages were regenerated.';
        renderCrudFeedback('success', 'Draft Published & Static Site Updated', publishMsg);
        renderTableCrudFeedback('success', 'Draft Published & Static Site Updated', publishMsg);
      } else if (regenStatus && regenStatus.status === 'static_host') {
        publishMsg +=
          ' Note: On static hosting, the published article will appear after the next deployment build.';
        renderCrudFeedback('warning', 'Draft Published in Supabase (Static Host Notice)', publishMsg);
        renderTableCrudFeedback('warning', 'Draft Published in Supabase (Static Host Notice)', publishMsg);
      } else {
        publishMsg +=
          ' Warning: Static regeneration could not complete (' +
          ((regenStatus && regenStatus.message) || 'endpoint unavailable') +
          ').';
        renderCrudFeedback('warning', 'Draft Published with Regeneration Warning', publishMsg);
        renderTableCrudFeedback('warning', 'Draft Published with Regeneration Warning', publishMsg);
      }
    } catch (err) {
      var msg = err && err.message ? err.message : 'Failed to publish draft.';
      renderCrudFeedback('error', 'Publish Failed', msg);
      renderTableCrudFeedback('error', 'Publish Failed', msg);
    } finally {
      state.publishingRowId = null;
      renderTable();
    }
  }

  function openDeleteConfirmationModal(postId) {
    if (state.isSaving || state.publishingRowId || state.deletingPostId) return;
    if (!isValidUuid(postId)) return;

    var bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (!bridge || !bridge.isAdminVerified()) return;

    var post = state.posts.find(function (p) {
      return p.id === postId;
    });
    if (!post || !isValidUuid(post.id)) return;

    var postStatusLower = String(post.status || '').toLowerCase();
    if (postStatusLower !== 'draft' && postStatusLower !== 'published') return;

    state.pendingDeletePost = post;

    var isPublished = postStatusLower === 'published';
    var isTl = post.language === 'tl';
    var urlPrefix = isTl ? '/tl/blog/' : '/blog/';
    var langLabel = isTl ? 'Filipino (TL)' : 'English (EN)';

    if (deleteModalPostTitle) {
      deleteModalPostTitle.textContent = post.title || '(Untitled Post)';
    }
    if (deleteModalPostStatus) {
      deleteModalPostStatus.textContent = isPublished
        ? 'Status: Published'
        : 'Status: Draft';
      deleteModalPostStatus.className = isPublished
        ? 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200'
        : 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200';
    }
    if (deleteModalPostSlug) {
      deleteModalPostSlug.textContent = langLabel + ' · ' + urlPrefix + post.slug + '/';
    }
    if (deleteModalPostId) {
      deleteModalPostId.textContent = post.id;
    }

    if (btnCancelDeletePost) {
      btnCancelDeletePost.disabled = false;
    }
    if (btnConfirmDeletePost) {
      btnConfirmDeletePost.disabled = false;
    }
    if (btnConfirmDeleteLabel) {
      btnConfirmDeleteLabel.textContent = 'Delete Post Permanently';
    }

    if (deletePostModal) {
      deletePostModal.classList.remove('hidden');
      deletePostModal.removeAttribute('aria-hidden');
    }
    if (btnCancelDeletePost) {
      btnCancelDeletePost.focus();
    }
  }

  function closeDeleteConfirmationModal(forceClose) {
    if (state.deletingPostId && !forceClose) {
      return;
    }

    state.pendingDeletePost = null;

    if (deletePostModal) {
      deletePostModal.classList.add('hidden');
      deletePostModal.setAttribute('aria-hidden', 'true');
    }
    if (btnCancelDeletePost) {
      btnCancelDeletePost.disabled = false;
    }
    if (btnConfirmDeletePost) {
      btnConfirmDeletePost.disabled = false;
    }
    if (btnConfirmDeleteLabel) {
      btnConfirmDeleteLabel.textContent = 'Delete Post Permanently';
    }
  }

  async function confirmDeletePost() {
    if (
      state.deletingPostId ||
      state.isSaving ||
      state.publishingRowId ||
      !state.pendingDeletePost
    ) {
      return;
    }

    var targetPost = state.pendingDeletePost;
    if (!targetPost || !isValidUuid(targetPost.id)) {
      closeDeleteConfirmationModal(true);
      return;
    }

    var bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (!bridge || !bridge.isAdminVerified()) {
      closeDeleteConfirmationModal(true);
      renderTableCrudFeedback(
        'error',
        'Administrator Session Required',
        'You must be signed in as a verified administrator in public.blog_admins to delete posts.'
      );
      renderCrudFeedback(
        'error',
        'Administrator Session Required',
        'You must be signed in as a verified administrator in public.blog_admins to delete posts.'
      );
      return;
    }

    state.deletingPostId = targetPost.id;
    if (btnCancelDeletePost) btnCancelDeletePost.disabled = true;
    if (btnConfirmDeletePost) btnConfirmDeletePost.disabled = true;
    if (btnConfirmDeleteLabel) {
      btnConfirmDeleteLabel.textContent = 'Deleting from Supabase…';
    }

    renderTableCrudFeedback(null);
    renderCrudFeedback(null);
    renderTable();
    updateActionButtonsState();

    try {
      var result = await bridge.deletePost(targetPost.id);

      if (result.status === 'unauthorized') {
        closeDeleteConfirmationModal(true);
        return;
      }

      if (result.status !== 'ok') {
        closeDeleteConfirmationModal(true);
        var errMsg =
          result.message || 'The selected blog post could not be deleted from Supabase.';
        renderTableCrudFeedback('error', 'Delete Failed', errMsg);
        renderCrudFeedback('error', 'Delete Failed', errMsg);
        return;
      }

      var deletedTitle = targetPost.title;
      var deletedStatusLabel =
        String(targetPost.status).toLowerCase() === 'published' ? 'Published' : 'Draft';
      var deletedUrlPath =
        (targetPost.language === 'tl' ? '/tl/blog/' : '/blog/') + targetPost.slug + '/';
      var deletedShortId = shortUuid(targetPost.id);
      var wasEditingDeletedPost = state.editingPostId === targetPost.id;

      closeDeleteConfirmationModal(true);

      if (wasEditingDeletedPost) {
        clearEditorSnapshot();
        resetEditorForm({ keepCrudBanner: true });
      }

      var confirmMessage =
        '"' +
        deletedTitle +
        '" (' +
        deletedStatusLabel +
        ' · ' +
        deletedUrlPath +
        ', UUID: ' +
        deletedShortId +
        ') was permanently deleted from public.blog_posts.' +
        (wasEditingDeletedPost
          ? ' The editor has been cleared and reset to Create New Post mode.'
          : '');

      var wasPublished = String(targetPost.status).toLowerCase() === 'published';

      var regenResults = await Promise.all([
        loadPostsFromSupabase(),
        triggerStaticBlogRegeneration()
      ]);
      var regenStatus = regenResults[1];

      if (!wasPublished) {
        renderTableCrudFeedback('success', 'Draft Post Deleted', confirmMessage);
        renderCrudFeedback('success', 'Draft Post Deleted', confirmMessage);
      } else if (regenStatus && regenStatus.ok) {
        var successWithStatic =
          confirmMessage +
          ' Static website files were regenerated and obsolete HTML removed.';
        renderTableCrudFeedback('success', 'Blog Post Deleted & Static Site Updated', successWithStatic);
        renderCrudFeedback('success', 'Blog Post Deleted & Static Site Updated', successWithStatic);
      } else if (regenStatus && regenStatus.status === 'static_host') {
        var staticHostNotice =
          confirmMessage +
          ' Note: On static hosting, the published page will be removed after the next deployment build.';
        renderTableCrudFeedback('warning', 'Blog Post Deleted from Database (Static Host)', staticHostNotice);
        renderCrudFeedback('warning', 'Blog Post Deleted from Database (Static Host)', staticHostNotice);
      } else {
        var regenWarning =
          confirmMessage +
          ' Warning: Static site regeneration could not complete (' +
          ((regenStatus && regenStatus.message) || 'endpoint unavailable') +
          '). Stale static HTML may remain locally until the next build.';
        renderTableCrudFeedback('warning', 'Blog Post Deleted with Regeneration Warning', regenWarning);
        renderCrudFeedback('warning', 'Blog Post Deleted with Regeneration Warning', regenWarning);
      }
    } catch (err) {
      closeDeleteConfirmationModal(true);
      var netMsg =
        err && err.message
          ? err.message
          : 'Network error while communicating with Supabase.';
      renderTableCrudFeedback('error', 'Delete Failed', netMsg);
      renderCrudFeedback('error', 'Delete Failed', netMsg);
    } finally {
      state.deletingPostId = null;
      renderTable();
      updateActionButtonsState();
    }
  }

  async function triggerStaticBlogRegeneration() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
      return { ok: false, status: 'unavailable', message: 'Window or fetch is not available.' };
    }
    try {
      var res = await window.fetch('/__suweldotools/regenerate-blog', {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });

      if (res.status === 404) {
        return {
          ok: false,
          status: 'static_host',
          message: 'Dev sync endpoint not present on static host. Changes will reflect on next deployment build.'
        };
      }

      if (!res.ok) {
        return {
          ok: false,
          status: 'http_error',
          message: 'Server responded with HTTP ' + res.status + ' (' + (res.statusText || 'Error') + ').'
        };
      }

      var data = await res.json();
      if (data && data.ok) {
        return {
          ok: true,
          status: 'generated',
          enCount: data.enCount || 0,
          tlCount: data.tlCount || 0,
          removedCount: data.removedCount || 0,
          message: data.message || 'Static blog pages regenerated successfully.'
        };
      }

      return {
        ok: false,
        status: data && data.status ? data.status : 'skipped_or_error',
        message: (data && data.message) || 'Static blog regeneration did not complete.'
      };
    } catch (err) {
      return {
        ok: false,
        status: 'network_error',
        message: err && err.message ? err.message : 'Could not contact static blog regeneration endpoint.'
      };
    }
  }

  // Register lifecycle hooks for /src/lib/supabase.ts
  window.__SUWELDOTOOLS_BLOG_ADMIN_UI__ = {
    onAdminAuthenticated: function () {
      // Never call resetEditorForm() on auth verification or token refresh so unsaved form data is preserved
      void loadPostsFromSupabase();
      void loadAnnouncementFromSupabase();
    },
    onAdminSignedOut: function () {
      state.posts = [];
      state.isLoadingPosts = false;
      state.fetchError = null;
      state.hasLoadedOnce = false;
      state.publishingRowId = null;
      state.deletingPostId = null;
      state.pendingDeletePost = null;
      state.isSaving = null;
      state.announcementDraft = null;
      state.announcementPublished = null;
      state.announcementDraftToken = null;
      state.announcementIsActive = false;
      state.isLoadingAnnouncement = false;
      state.isSavingAnnouncement = false;
      state.announcementHasLoaded = false;
      closeDeleteConfirmationModal(true);
      closeUnsavedChangesModal();
      if (tableErrorBanner) tableErrorBanner.classList.add('hidden');
      if (announcementConflictBanner) announcementConflictBanner.classList.add('hidden');
      renderAnnouncementFeedback(null);
      renderTableCrudFeedback(null);
      clearEditorSnapshot();
      resetEditorForm();
      setActiveNav('dashboard');
      updateMetrics('all');
      renderTable();
    }
  };

  function handleEditPostRequest(postId) {
    var postToEdit = state.posts.find(function (p) {
      return p.id === postId;
    });
    if (!postToEdit) return;

    // If this exact post is already loaded in the editor, switch to the dedicated editor view preserving unsaved edits
    if (state.editingPostId === postToEdit.id) {
      showEditorView();
      return;
    }

    // If unsaved changes exist in the editor (or another database post is currently loaded), confirm before replacing
    if (hasUnsavedEditorChanges() || state.editingPostId) {
      var hasEdits = hasUnsavedEditorChanges();
      openUnsavedChangesModal(
        'Load "' +
          postToEdit.title +
          '" (' +
          postToEdit.language.toUpperCase() +
          ') into the editor',
        function () {
          loadDatabasePostIntoEditor(postToEdit);
        },
        {
          title: hasEdits
            ? 'Replace Unsaved Blog Post Data?'
            : 'Switch Active Post in Editor?',
          description: hasEdits
            ? 'You have unsaved changes in the Blog Post Editor. Loading another post will discard your current unsaved edits unless you save them first.'
            : 'Another database post is currently loaded in the editor. Continue to load the selected post into the editor?'
        }
      );
      return;
    }

    loadDatabasePostIntoEditor(postToEdit);
  }

  // Event Listeners
  navButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-nav-target') || 'dashboard';
      if (target === 'create-post') {
        requestCreatePostMode();
      } else {
        setActiveNav(target);
      }
    });
  });

  if (btnDashboardViewAllPosts) {
    btnDashboardViewAllPosts.addEventListener('click', function () {
      setActiveNav('all-posts');
    });
  }

  if (btnResumeEditorSession) {
    btnResumeEditorSession.addEventListener('click', function () {
      showEditorView();
    });
  }

  if (btnBackToPosts) {
    btnBackToPosts.addEventListener('click', function () {
      setActiveNav('all-posts');
    });
  }

  if (globalLangFilter) {
    globalLangFilter.addEventListener('change', function () {
      var val = globalLangFilter.value;
      if (tableLangSelect) tableLangSelect.value = val;
      if (
        !state.editingPostId &&
        !hasUnsavedEditorChanges() &&
        inputLanguage &&
        (val === 'en' || val === 'tl')
      ) {
        inputLanguage.value = val;
        updateSlugPrefix();
        updateActionButtonsState();
      }
      updateMetrics(val);
      renderTable();
    });
  }

  if (tableLangSelect) {
    tableLangSelect.addEventListener('change', function () {
      var val = tableLangSelect.value;
      if (globalLangFilter) globalLangFilter.value = val;
      updateMetrics(val);
      renderTable();
    });
  }

  if (tableStatusSelect) {
    tableStatusSelect.addEventListener('change', renderTable);
  }

  if (searchInput) {
    searchInput.addEventListener('input', renderTable);
  }

  if (btnRefreshPosts) {
    btnRefreshPosts.addEventListener('click', function () {
      void loadPostsFromSupabase();
    });
  }

  if (btnRetryFetchPosts) {
    btnRetryFetchPosts.addEventListener('click', function () {
      void loadPostsFromSupabase();
    });
  }

  if (dashboardRecentPostsBody) {
    dashboardRecentPostsBody.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var button = target.closest('button[data-action="edit-post"]');
      if (!button) return;
      var postId = button.getAttribute('data-post-id');
      if (postId) {
        handleEditPostRequest(postId);
      }
    });
  }

  if (tableBody) {
    tableBody.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var button = target.closest('button[data-action]');
      if (!button) return;

      var action = button.getAttribute('data-action');
      var postId = button.getAttribute('data-post-id');
      if (!postId) return;

      if (action === 'edit-post') {
        handleEditPostRequest(postId);
      } else if (action === 'publish-row') {
        void publishDraftRowFromTable(postId);
      } else if (action === 'delete-post') {
        openDeleteConfirmationModal(postId);
      }
    });
  }

  if (btnCancelDeletePost) {
    btnCancelDeletePost.addEventListener('click', function () {
      closeDeleteConfirmationModal(false);
    });
  }

  if (btnConfirmDeletePost) {
    btnConfirmDeletePost.addEventListener('click', function () {
      void confirmDeletePost();
    });
  }

  if (deletePostModal) {
    deletePostModal.addEventListener('click', function (e) {
      if (e.target === deletePostModal) {
        closeDeleteConfirmationModal(false);
      }
    });
  }

  if (btnCancelDiscardChanges) {
    btnCancelDiscardChanges.addEventListener('click', function () {
      closeUnsavedChangesModal();
    });
  }

  if (btnConfirmDiscardChanges) {
    btnConfirmDiscardChanges.addEventListener('click', function () {
      confirmDiscardUnsavedChanges();
    });
  }

  if (unsavedChangesModal) {
    unsavedChangesModal.addEventListener('click', function (e) {
      if (e.target === unsavedChangesModal) {
        closeUnsavedChangesModal();
      }
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (unsavedChangesModal && !unsavedChangesModal.classList.contains('hidden')) {
        closeUnsavedChangesModal();
        return;
      }
      if (deletePostModal && !deletePostModal.classList.contains('hidden')) {
        closeDeleteConfirmationModal(false);
      }
    }
  });

  if (btnCreateNewPost) {
    btnCreateNewPost.addEventListener('click', function () {
      requestCreatePostMode();
    });
  }

  if (btnTableCreateNewPost) {
    btnTableCreateNewPost.addEventListener('click', function () {
      requestCreatePostMode();
    });
  }

  if (btnResetForm) {
    btnResetForm.addEventListener('click', function () {
      if (hasUnsavedEditorChanges() || state.editingPostId) {
        openUnsavedChangesModal(
          'Clear all fields and reset the editor to Create New Post mode',
          function () {
            clearEditorSnapshot();
            resetEditorForm();
            setActiveNav('create-post');
          },
          {
            title: 'Clear Form & Start New Post?',
            description:
              'Clearing the form will reset all current fields and switch the editor to a blank Create New Post state.'
          }
        );
        return;
      }
      clearEditorSnapshot();
      resetEditorForm();
      if (inputTitle) inputTitle.focus();
    });
  }

  if (inputLanguage) {
    inputLanguage.addEventListener('change', function () {
      state.languageTouched = true;
      updateSlugPrefix();
      updateActionButtonsState();
      saveEditorSnapshot();
    });
  }

  if (btnGenerateSlug) {
    btnGenerateSlug.addEventListener('click', function () {
      if (!inputTitle || !inputSlug) return;
      var generated = slugify(inputTitle.value);
      if (generated) {
        inputSlug.value = generated;
        updateActionButtonsState();
        saveEditorSnapshot();
      }
    });
  }

  if (inputTitle) {
    inputTitle.addEventListener('blur', function () {
      if (inputSlug && !inputSlug.value.trim() && inputTitle.value.trim()) {
        inputSlug.value = slugify(inputTitle.value);
        updateActionButtonsState();
        saveEditorSnapshot();
      }
    });
  }

  function handleImageFileSelectionChange() {
    revokeLocalImagePreviewUrl();

    var file =
      inputImageFile && inputImageFile.files && inputImageFile.files.length > 0
        ? inputImageFile.files[0]
        : null;

    if (!file) {
      state.selectedImageFile = null;
      renderImageUploadStatus(null);
      updateEditorImagePreview();
      updateActionButtonsState();
      return;
    }

    var validation = validateImageFileClient(file);
    if (!validation.valid) {
      state.selectedImageFile = null;
      if (inputImageFile) {
        inputImageFile.value = '';
      }
      renderImageUploadStatus('error', 'Invalid Image File', validation.error);
      updateEditorImagePreview();
      updateActionButtonsState();
      return;
    }

    state.selectedImageFile = file;
    try {
      if (window.URL && typeof window.URL.createObjectURL === 'function') {
        state.localImagePreviewUrl = window.URL.createObjectURL(file);
      }
    } catch (_err) {
      state.localImagePreviewUrl = null;
    }

    renderImageUploadStatus(
      'info',
      'Image Ready to Upload',
      'Selected "' +
        file.name +
        '" (' +
        formatFileSize(file.size) +
        '). Click "Upload Image" to upload to Supabase Storage and populate the Featured Image URL.'
    );
    updateEditorImagePreview();
    updateActionButtonsState();
  }

  async function handleUploadSelectedImage() {
    if (state.isUploadingImage || state.isSaving || state.deletingPostId) {
      return;
    }

    var file =
      state.selectedImageFile ||
      (inputImageFile && inputImageFile.files && inputImageFile.files[0]) ||
      null;

    var validation = validateImageFileClient(file);
    if (!validation.valid) {
      renderImageUploadStatus('error', 'Cannot Upload Image', validation.error);
      updateActionButtonsState();
      return;
    }

    var bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (!bridge || typeof bridge.uploadImage !== 'function') {
      try {
        var mod = await import('/src/lib/supabase.ts?v=step16b-image-upload-v2');
        bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
        if (bridge && typeof bridge.uploadImage !== 'function' && mod && typeof mod.uploadAdminBlogImage === 'function') {
          bridge.uploadImage = mod.uploadAdminBlogImage;
        }
      } catch (_importErr) {
        // Handled below if bridge.uploadImage is still unavailable
      }
    }

    if (!bridge || typeof bridge.uploadImage !== 'function') {
      renderImageUploadStatus(
        'error',
        'Upload Service Unavailable',
        'Supabase admin storage bridge is not initialized. Refresh the page and sign in again.'
      );
      return;
    }

    if (typeof bridge.isAdminVerified === 'function' && !bridge.isAdminVerified()) {
      renderImageUploadStatus(
        'error',
        'Administrator Session Required',
        'You must be signed in as a verified administrator in public.blog_admins to upload images.'
      );
      return;
    }

    state.isUploadingImage = true;
    renderImageUploadStatus(
      'info',
      'Uploading Featured Image…',
      'Uploading "' +
        file.name +
        '" (' +
        formatFileSize(file.size) +
        ') to Supabase Storage bucket blog-images/featured/…'
    );
    updateEditorImagePreview();
    updateActionButtonsState();

    try {
      var result = await bridge.uploadImage(file);
      state.isUploadingImage = false;

      if (result && result.status === 'unauthorized') {
        updateEditorImagePreview();
        updateActionButtonsState();
        return;
      }

      var isSuccess =
        Boolean(result) &&
        (result.status === 'ok' || result.ok === true) &&
        Boolean(result.publicUrl);

      if (!isSuccess) {
        renderImageUploadStatus(
          'error',
          'Featured Image Upload Failed',
          (result && (result.message || result.error)) ||
            'Supabase Storage rejected the image upload. Verify your admin session and bucket policies.'
        );
        updateEditorImagePreview();
        updateActionButtonsState();
        return;
      }

      if (inputImageUrl) {
        inputImageUrl.value = result.publicUrl;
        inputImageUrl.removeAttribute('aria-invalid');
        inputImageUrl.classList.remove('border-red-500');
      }
      var urlErrEl = document.getElementById('post-image-url-error');
      if (urlErrEl) {
        urlErrEl.textContent = '';
        urlErrEl.classList.add('hidden');
      }

      clearSelectedImageFileSelection(true);

      var hasAlt = Boolean(inputImageAlt && inputImageAlt.value.trim());
      renderImageUploadStatus(
        'success',
        'Featured Image Uploaded',
        'Uploaded to blog-images/' +
          (result.objectPath || 'featured/') +
          ' and populated Featured Image URL.' +
          (hasAlt
            ? ''
            : ' Please enter Featured Image Alt Text before saving or publishing.')
      );

      updateEditorImagePreview();
      updateCounters();
      saveEditorSnapshot();
    } catch (err) {
      state.isUploadingImage = false;
      var msg =
        err instanceof Error ? err.message : 'Unexpected network error during image upload.';
      renderImageUploadStatus('error', 'Featured Image Upload Failed', msg);
      updateEditorImagePreview();
      updateActionButtonsState();
    }
  }

  function handleClearFeaturedImage() {
    if (state.isUploadingImage || state.isSaving) return;

    var hadUrlOrAlt = Boolean(
      (inputImageUrl && inputImageUrl.value.trim()) ||
        (inputImageAlt && inputImageAlt.value.trim())
    );
    var hadSelectedFile = Boolean(state.selectedImageFile);

    clearSelectedImageFileSelection(true);

    if (inputImageUrl) {
      inputImageUrl.value = '';
      inputImageUrl.removeAttribute('aria-invalid');
      inputImageUrl.classList.remove('border-red-500');
    }
    if (inputImageAlt) {
      inputImageAlt.value = '';
      inputImageAlt.removeAttribute('aria-invalid');
      inputImageAlt.classList.remove('border-red-500');
    }

    var urlErrEl = document.getElementById('post-image-url-error');
    if (urlErrEl) {
      urlErrEl.textContent = '';
      urlErrEl.classList.add('hidden');
    }
    var altErrEl = document.getElementById('post-image-alt-error');
    if (altErrEl) {
      altErrEl.textContent = '';
      altErrEl.classList.add('hidden');
    }

    if (hadUrlOrAlt || hadSelectedFile) {
      renderImageUploadStatus(
        'info',
        'Featured Image Cleared',
        'Cleared the Featured Image URL, Alt Text, and file selection from this form. Stored files in Supabase Storage are not deleted.'
      );
    } else {
      renderImageUploadStatus(null);
    }

    updateEditorImagePreview();
    updateCounters();
    saveEditorSnapshot();
  }

  if (imagePreviewImg) {
    imagePreviewImg.addEventListener('error', function () {
      if (!imagePreviewImg.getAttribute('src')) return;
      imagePreviewImg.classList.add('hidden');
      if (imagePreviewError) {
        imagePreviewError.textContent = 'Preview unavailable for this URL';
        imagePreviewError.classList.remove('hidden');
      }
    });
    imagePreviewImg.addEventListener('load', function () {
      if (imagePreviewError) {
        imagePreviewError.classList.add('hidden');
      }
      imagePreviewImg.classList.remove('hidden');
    });
  }

  if (inputImageFile) {
    inputImageFile.addEventListener('change', handleImageFileSelectionChange);
  }

  if (btnUploadImage) {
    btnUploadImage.addEventListener('click', function () {
      void handleUploadSelectedImage();
    });
  }

  if (btnClearImage) {
    btnClearImage.addEventListener('click', handleClearFeaturedImage);
  }

  if (btnAddFaq) {
    btnAddFaq.addEventListener('click', function () {
      if (state.isSaving || state.deletingPostId || state.isUploadingImage) return;
      state.faqs.push({ question: '', answer: '' });
      renderFaqRepeater();
      updateActionButtonsState();
      saveEditorSnapshot();
      var newIdx = state.faqs.length - 1;
      var newQuestionInput = document.getElementById('post-faq-question-' + newIdx);
      if (newQuestionInput) {
        newQuestionInput.focus();
      }
    });
  }

  if (faqsListEl) {
    faqsListEl.addEventListener('input', function (e) {
      var target = e.target;
      if (!target || !target.getAttribute) return;
      var field = target.getAttribute('data-faq-field');
      var idxStr = target.getAttribute('data-faq-index');
      if (!field || idxStr === null) return;
      var idx = parseInt(idxStr, 10);
      if (isNaN(idx) || !state.faqs[idx]) return;

      if (field === 'question') {
        state.faqs[idx].question = target.value;
      } else if (field === 'answer') {
        state.faqs[idx].answer = target.value;
      }
      var faqErrEl = document.getElementById('post-faqs-error');
      if (faqErrEl && findFirstIncompleteFaqRowIndex(state.faqs) === -1) {
        faqErrEl.textContent = '';
        faqErrEl.classList.add('hidden');
      }
      updateActionButtonsState();
      saveEditorSnapshot();
    });

    faqsListEl.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var btn = target.closest('button[data-faq-action]');
      if (!btn) return;
      if (state.isSaving || state.deletingPostId || state.isUploadingImage) return;

      var action = btn.getAttribute('data-faq-action');
      var idxStr = btn.getAttribute('data-faq-index');
      var idx = parseInt(idxStr || '', 10);
      if (isNaN(idx) || idx < 0 || idx >= state.faqs.length) return;

      if (action === 'remove') {
        state.faqs.splice(idx, 1);
      } else if (action === 'move-up' && idx > 0) {
        var tempUp = state.faqs[idx - 1];
        state.faqs[idx - 1] = state.faqs[idx];
        state.faqs[idx] = tempUp;
      } else if (action === 'move-down' && idx < state.faqs.length - 1) {
        var tempDown = state.faqs[idx + 1];
        state.faqs[idx + 1] = state.faqs[idx];
        state.faqs[idx] = tempDown;
      }

      renderFaqRepeater();
      updateActionButtonsState();
      saveEditorSnapshot();
    });
  }

  [
    inputTitle,
    inputSlug,
    inputAuthorName,
    inputExcerpt,
    inputContent,
    inputSeoTitle,
    inputMetaDesc,
    inputImageUrl,
    inputImageAlt
  ].forEach(function (el) {
    if (el) {
      el.addEventListener('input', function () {
        if (el === inputImageUrl || el === inputImageAlt) {
          updateEditorImagePreview();
        }
        updateCounters();
        saveEditorSnapshot();
      });
    }
  });

  if (btnPreviewPost) {
    btnPreviewPost.addEventListener('click', renderPreview);
  }

  if (btnClosePreview) {
    btnClosePreview.addEventListener('click', function () {
      if (sectionPostPreview) sectionPostPreview.classList.add('hidden');
      if (btnPreviewPost) btnPreviewPost.focus();
    });
  }

  if (btnSaveDraft) {
    btnSaveDraft.addEventListener('click', function () {
      void submitPostWithStatus('draft');
    });
  }

  if (btnPublishPost) {
    btnPublishPost.addEventListener('click', function () {
      void submitPostWithStatus('published');
    });
  }

  // ==========================================
  // ANNOUNCEMENT POPUP CONTROLLER & BRIDGE
  // ==========================================

  function renderAnnouncementFeedback(variant, title, body) {
    if (!announcementFeedbackBanner || !announcementFeedbackTitle || !announcementFeedbackBody) return;
    if (!variant) {
      announcementFeedbackBanner.classList.add('hidden');
      announcementFeedbackTitle.textContent = '';
      announcementFeedbackBody.textContent = '';
      return;
    }
    announcementFeedbackTitle.textContent = title || '';
    announcementFeedbackBody.textContent = body || '';
    announcementFeedbackBanner.classList.remove('hidden');

    if (variant === 'success') {
      announcementFeedbackBanner.className =
        'rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 p-4 text-xs sm:text-sm leading-relaxed';
    } else if (variant === 'warning') {
      announcementFeedbackBanner.className =
        'rounded-xl border border-amber-300 bg-amber-50 text-amber-900 p-4 text-xs sm:text-sm leading-relaxed';
    } else {
      announcementFeedbackBanner.className =
        'rounded-xl border border-red-300 bg-red-50 text-red-900 p-4 text-xs sm:text-sm leading-relaxed';
    }
  }

  function updateAnnouncementBadge(isActive) {
    state.announcementIsActive = Boolean(isActive);
    if (announcementActiveBadge) {
      if (state.announcementIsActive) {
        announcementActiveBadge.textContent = 'Active (Live Sitewide)';
        announcementActiveBadge.className =
          'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border bg-emerald-50 text-emerald-700 border-emerald-200';
      } else {
        announcementActiveBadge.textContent = 'Disabled (Inactive)';
        announcementActiveBadge.className =
          'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border bg-slate-100 text-slate-600 border-slate-200';
      }
    }

    if (btnToggleAnnouncementActive && btnToggleAnnouncementLabel) {
      if (state.announcementIsActive) {
        btnToggleAnnouncementLabel.textContent = 'Disable Announcement';
        btnToggleAnnouncementActive.className =
          'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer border shadow-2xs bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300';
      } else {
        btnToggleAnnouncementLabel.textContent = 'Enable Sitewide Announcement';
        btnToggleAnnouncementActive.className =
          'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer border shadow-2xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300';
      }
    }
  }

  function updateAnnouncementTokenBadge(token, updatedAt) {
    state.announcementDraftToken = token || null;
    if (announcementTokenDisplay) {
      if (token) {
        announcementTokenDisplay.textContent = shortUuid(token);
        announcementTokenDisplay.title = token;
        announcementTokenDisplay.className =
          'bg-emerald-50 px-1.5 py-0.5 rounded text-emerald-800 font-mono text-[11px] font-bold border border-emerald-200';
      } else {
        announcementTokenDisplay.textContent = 'Unsynchronized';
        announcementTokenDisplay.className =
          'bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-bold';
      }
    }
    if (announcementLastUpdatedText) {
      if (updatedAt) {
        announcementLastUpdatedText.textContent = 'Last synced with database: ' + formatTimestamp(updatedAt);
      } else {
        announcementLastUpdatedText.textContent = 'Ready to edit and save.';
      }
    }
  }

  function setAnnouncementSyncErrorState(statusBadgeText, syncStatusMessage) {
    state.announcementHasLoaded = false;
    state.announcementDraftToken = null;
    if (announcementActiveBadge) {
      announcementActiveBadge.textContent = statusBadgeText || 'Status Unavailable';
      announcementActiveBadge.className =
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border bg-amber-50 text-amber-800 border-amber-200';
    }
    if (announcementTokenDisplay) {
      announcementTokenDisplay.textContent = 'Unsynchronized';
      announcementTokenDisplay.removeAttribute('title');
      announcementTokenDisplay.className =
        'bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-bold';
    }
    if (announcementLastUpdatedText) {
      announcementLastUpdatedText.textContent =
        syncStatusMessage || 'Database sync failed — click Reload State or run the SQL migration.';
    }
  }

  function getAnnouncementFormValues() {
    var styleRadios = document.querySelectorAll('input[name="announcement-display-style"]');
    var selectedStyle = 'modal';
    styleRadios.forEach(function (r) {
      if (r.checked) selectedStyle = r.value;
    });

    return {
      display_style: selectedStyle,
      title_en: inputAnnTitleEn ? inputAnnTitleEn.value.trim() : '',
      body_en: inputAnnBodyEn ? inputAnnBodyEn.value.trim() : '',
      title_tl: inputAnnTitleTl ? inputAnnTitleTl.value.trim() : '',
      body_tl: inputAnnBodyTl ? inputAnnBodyTl.value.trim() : '',
      image_url: inputAnnImageUrl ? inputAnnImageUrl.value.trim() : '',
      image_alt_en: inputAnnImageAltEn ? inputAnnImageAltEn.value.trim() : '',
      image_alt_tl: inputAnnImageAltTl ? inputAnnImageAltTl.value.trim() : '',
      link_url: inputAnnLinkUrl ? inputAnnLinkUrl.value.trim() : '',
      link_label_en: inputAnnLinkLabelEn ? inputAnnLinkLabelEn.value.trim() : '',
      link_label_tl: inputAnnLinkLabelTl ? inputAnnLinkLabelTl.value.trim() : ''
    };
  }

  function setAnnouncementFormValues(rec) {
    if (!rec) return;
    var styleVal = rec.display_style === 'banner' ? 'banner' : 'modal';
    var styleRadios = document.querySelectorAll('input[name="announcement-display-style"]');
    styleRadios.forEach(function (r) {
      r.checked = r.value === styleVal;
    });

    if (inputAnnTitleEn) inputAnnTitleEn.value = rec.title_en || '';
    if (inputAnnBodyEn) inputAnnBodyEn.value = rec.body_en || '';
    if (inputAnnTitleTl) inputAnnTitleTl.value = rec.title_tl || '';
    if (inputAnnBodyTl) inputAnnBodyTl.value = rec.body_tl || '';
    if (inputAnnImageUrl) inputAnnImageUrl.value = rec.image_url || '';
    if (inputAnnImageAltEn) inputAnnImageAltEn.value = rec.image_alt_en || '';
    if (inputAnnImageAltTl) inputAnnImageAltTl.value = rec.image_alt_tl || '';
    if (inputAnnLinkUrl) inputAnnLinkUrl.value = rec.link_url || '';
    if (inputAnnLinkLabelEn) inputAnnLinkLabelEn.value = rec.link_label_en || '';
    if (inputAnnLinkLabelTl) inputAnnLinkLabelTl.value = rec.link_label_tl || '';

    updateAnnouncementLivePreview();
  }

  function updateAnnouncementLivePreview() {
    var vals = getAnnouncementFormValues();
    var isTl = state.announcementPreviewLang === 'tl';

    var displayTitle = isTl ? (vals.title_tl || vals.title_en) : (vals.title_en || vals.title_tl);
    var displayBody = isTl ? (vals.body_tl || vals.body_en) : (vals.body_en || vals.body_tl);
    var displayAlt = isTl ? (vals.image_alt_tl || vals.image_alt_en) : (vals.image_alt_en || vals.image_alt_tl);
    var displayCta = isTl ? (vals.link_label_tl || vals.link_label_en) : (vals.link_label_en || vals.link_label_tl);

    if (annPreviewTitle) {
      annPreviewTitle.textContent = displayTitle || (isTl ? '(Pamagat ng Anunsyo)' : '(Announcement Title Preview)');
    }
    if (annPreviewBody) {
      annPreviewBody.textContent = displayBody || (isTl ? '(Lalabas dito ang nilalaman habang nagta-type ka...)' : '(Announcement body preview will update live as you type...)');
    }

    if (annPreviewImageBox && annPreviewImageImg) {
      if (vals.image_url) {
        annPreviewImageImg.src = vals.image_url;
        annPreviewImageImg.alt = displayAlt || displayTitle || (isTl ? 'Larawan ng anunsyo' : 'Announcement image');
        annPreviewImageBox.classList.remove('hidden');
      } else {
        annPreviewImageImg.removeAttribute('src');
        annPreviewImageBox.classList.add('hidden');
      }
    }

    if (annPreviewCtaBox && annPreviewCtaLabel) {
      if (vals.link_url) {
        annPreviewCtaLabel.textContent = displayCta || (isTl ? 'Alamin ang Higit Pa' : 'Learn More');
        annPreviewCtaBox.classList.remove('hidden');
      } else {
        annPreviewCtaBox.classList.add('hidden');
      }
    }
  }

  async function loadAnnouncementFromSupabase() {
    var bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (!bridge || !bridge.isAdminVerified()) {
      return;
    }

    state.isLoadingAnnouncement = true;
    renderAnnouncementFeedback(null);
    if (announcementConflictBanner) announcementConflictBanner.classList.add('hidden');

    var fetchFn = bridge.fetchAnnouncementState || bridge.fetchAnnouncementAdminState;
    if (typeof fetchFn !== 'function') {
      state.isLoadingAnnouncement = false;
      setAnnouncementSyncErrorState('Bridge Not Ready', 'Announcement bridge functions are not initialized.');
      renderAnnouncementFeedback('error', 'Bridge Not Ready', 'Announcement bridge functions are not initialized. Please hard-refresh the page.');
      return;
    }

    try {
      var res = await fetchFn();
      if (res.status === 'unauthorized') {
        setAnnouncementSyncErrorState('Unauthorized', 'Administrator verification required.');
        renderAnnouncementFeedback('error', 'Unauthorized', 'You must be signed in as a verified administrator.');
        return;
      }
      if (res.status === 'error') {
        setAnnouncementSyncErrorState(
          'Status Unavailable',
          'Database sync failed — run the site_announcements SQL migration or click Reload State.'
        );
        renderAnnouncementFeedback('error', 'Fetch Notice', res.message || 'Could not fetch announcement state from database.');
        return;
      }

      var resolvedToken =
        res.draft_lock_token || (res.draft && res.draft.draft_lock_token) || null;
      if (!resolvedToken) {
        setAnnouncementSyncErrorState(
          'Unsynchronized',
          'Draft lock token missing from database response — check migration state.'
        );
        renderAnnouncementFeedback(
          'error',
          'Fetch Notice',
          'Announcement draft lock token was not returned. Please ensure the site_announcements migration is applied in Supabase.'
        );
        return;
      }

      state.announcementHasLoaded = true;
      state.announcementDraft = res.draft;
      state.announcementPublished = res.published;
      updateAnnouncementBadge(res.is_active);

      var sourceRecord = res.draft || res.published;
      if (sourceRecord) {
        setAnnouncementFormValues(sourceRecord);
        updateAnnouncementTokenBadge(resolvedToken, sourceRecord.updated_at);
      } else {
        updateAnnouncementTokenBadge(resolvedToken, null);
      }
    } catch (err) {
      var msg = err && err.message ? err.message : 'Network error while fetching announcement.';
      setAnnouncementSyncErrorState('Connection Error', 'Could not reach Supabase — click Reload State to retry.');
      renderAnnouncementFeedback('error', 'Fetch Failed', msg);
    } finally {
      state.isLoadingAnnouncement = false;
    }
  }

  function isSafeAnnouncementUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    var trimmed = rawUrl.trim();
    if (!trimmed) return false;

    // Reject backslashes anywhere in the URL (stops backslash bypasses)
    if (trimmed.indexOf('\\') !== -1) return false;

    // Reject whitespace or control characters
    if (/[\x00-\x1F\x7F\s]/.test(trimmed)) return false;

    // Root-relative URL check: must start with single '/' and NOT '//' or '/\'
    if (trimmed.startsWith('/')) {
      if (trimmed.length > 1 && (trimmed[1] === '/' || trimmed[1] === '\\')) {
        return false;
      }
      return true;
    }

    // External URL check: must be strictly https: with RFC-compliant hostname
    try {
      var parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:') {
        return false;
      }
      var rfcHostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
      if (!parsed.hostname || !rfcHostnameRegex.test(parsed.hostname)) {
        return false;
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  function validateAnnouncementForm() {
    var vals = getAnnouncementFormValues();
    var errors = [];

    var effectiveTitleEn = vals.title_en || vals.title_tl;
    var effectiveBodyEn = vals.body_en || vals.body_tl;

    if (!effectiveTitleEn) {
      errors.push('Announcement Title is required.');
    }
    if (!effectiveBodyEn) {
      errors.push('Announcement Message Body is required.');
    }

    if (vals.image_url && !isSafeAnnouncementUrl(vals.image_url)) {
      errors.push('Image URL must start with https:// or / (safe root-relative path). Insecure and protocol-relative URLs are rejected.');
    }

    if (vals.link_url && !isSafeAnnouncementUrl(vals.link_url)) {
      errors.push('Button Link URL must start with https:// or / (safe root-relative path). Insecure and protocol-relative URLs are rejected.');
    }

    if (errors.length > 0) {
      renderAnnouncementFeedback('error', 'Validation Error', errors.join(' '));
      return false;
    }
    return true;
  }

  function buildNormalizedAnnouncementPayload() {
    var vals = getAnnouncementFormValues();
    var titleEn = vals.title_en || vals.title_tl;
    var titleTl = vals.title_tl || vals.title_en;
    var bodyEn = vals.body_en || vals.body_tl;
    var bodyTl = vals.body_tl || vals.body_en;
    var hasImage = Boolean(vals.image_url);
    var hasLink = Boolean(vals.link_url);

    // Populate any auto-filled fields in the form so the admin sees them clearly
    if (inputAnnTitleEn && !inputAnnTitleEn.value.trim() && titleEn) inputAnnTitleEn.value = titleEn;
    if (inputAnnTitleTl && !inputAnnTitleTl.value.trim() && titleTl) inputAnnTitleTl.value = titleTl;
    if (inputAnnBodyEn && !inputAnnBodyEn.value.trim() && bodyEn) inputAnnBodyEn.value = bodyEn;
    if (inputAnnBodyTl && !inputAnnBodyTl.value.trim() && bodyTl) inputAnnBodyTl.value = bodyTl;

    return {
      expected_draft_lock_token: state.announcementDraftToken || '',
      display_style: vals.display_style,
      title_en: titleEn,
      body_en: bodyEn,
      title_tl: titleTl,
      body_tl: bodyTl,
      image_url: hasImage ? vals.image_url : null,
      image_alt_en: hasImage ? (vals.image_alt_en || titleEn) : null,
      image_alt_tl: hasImage ? (vals.image_alt_tl || titleTl) : null,
      link_url: hasLink ? vals.link_url : null,
      link_label_en: hasLink ? (vals.link_label_en || 'Learn More') : null,
      link_label_tl: hasLink ? (vals.link_label_tl || 'Alamin ang Higit Pa') : null
    };
  }

  async function saveAnnouncementDraftSubmit() {
    if (state.isSavingAnnouncement) return;

    var bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (!bridge || !bridge.isAdminVerified()) {
      renderAnnouncementFeedback('error', 'Unauthorized', 'You must be signed in as a blog admin.');
      return;
    }

    if (!validateAnnouncementForm()) return;

    state.isSavingAnnouncement = true;
    if (btnSaveAnnouncementDraft) btnSaveAnnouncementDraft.disabled = true;
    if (btnSaveAnnouncementDraftLabel) btnSaveAnnouncementDraftLabel.textContent = 'Saving Draft…';
    renderAnnouncementFeedback(null);
    if (announcementConflictBanner) announcementConflictBanner.classList.add('hidden');

    try {
      var input = buildNormalizedAnnouncementPayload();
      var res = await bridge.saveAnnouncementDraft(input);

      if (res.status === 'conflict') {
        if (announcementConflictBanner) announcementConflictBanner.classList.remove('hidden');
        if (announcementConflictMessage) {
          announcementConflictMessage.textContent = res.message || 'Optimistic lock conflict: another admin updated the draft.';
        }
        renderAnnouncementFeedback('warning', 'Save Conflict', 'Your draft could not be saved because the database token changed. Click Reload Latest Draft below.');
        return;
      }

      if (res.status === 'unauthorized') {
        renderAnnouncementFeedback('error', 'Unauthorized', res.message || 'Admin authorization required.');
        return;
      }

      if (res.status === 'error' || res.status === 'validation_error') {
        renderAnnouncementFeedback('error', 'Save Failed', res.message || 'Database error while saving draft.');
        return;
      }

      // Success
      state.announcementHasLoaded = true;
      if (res.draft) {
        state.announcementDraft = res.draft;
      }
      var returnedToken = res.new_draft_lock_token || res.newToken;
      if (returnedToken) {
        updateAnnouncementTokenBadge(returnedToken, new Date().toISOString());
      }
      updateAnnouncementLivePreview();
      renderAnnouncementFeedback('success', 'Draft Saved', 'Announcement draft successfully saved to Supabase (token ' + shortUuid(returnedToken) + ').');
    } catch (err) {
      var msg = err && err.message ? err.message : 'Network error while saving draft.';
      renderAnnouncementFeedback('error', 'Save Draft Failed', msg);
    } finally {
      state.isSavingAnnouncement = false;
      if (btnSaveAnnouncementDraft) btnSaveAnnouncementDraft.disabled = false;
      if (btnSaveAnnouncementDraftLabel) btnSaveAnnouncementDraftLabel.textContent = 'Save Draft';
    }
  }

  async function publishAnnouncementSubmit() {
    if (state.isSavingAnnouncement) return;

    var bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (!bridge || !bridge.isAdminVerified()) {
      renderAnnouncementFeedback('error', 'Unauthorized', 'You must be signed in as a blog admin.');
      return;
    }

    if (!validateAnnouncementForm()) return;

    state.isSavingAnnouncement = true;
    if (btnPublishAnnouncement) btnPublishAnnouncement.disabled = true;
    if (btnPublishAnnouncementLabel) btnPublishAnnouncementLabel.textContent = 'Publishing…';
    renderAnnouncementFeedback(null);
    if (announcementConflictBanner) announcementConflictBanner.classList.add('hidden');

    try {
      // First save draft with current form values to ensure database draft reflects current inputs
      var draftInput = buildNormalizedAnnouncementPayload();
      var draftSaveRes = await bridge.saveAnnouncementDraft(draftInput);

      if (draftSaveRes.status === 'conflict') {
        if (announcementConflictBanner) announcementConflictBanner.classList.remove('hidden');
        renderAnnouncementFeedback('warning', 'Publish Conflict', 'The draft was updated by another administrator. Please reload latest draft first.');
        return;
      }
      if (draftSaveRes.status !== 'success' && draftSaveRes.status !== 'ok') {
        renderAnnouncementFeedback('error', 'Publish Failed', draftSaveRes.message || 'Could not save draft before publishing.');
        return;
      }

      var currentToken = draftSaveRes.new_draft_lock_token || draftSaveRes.newToken || state.announcementDraftToken || '';
      updateAnnouncementTokenBadge(currentToken, new Date().toISOString());

      // Now publish from the updated draft slot
      var publishRes = await bridge.publishAnnouncement({
        expected_draft_lock_token: currentToken
      });

      if (publishRes.status === 'conflict') {
        if (announcementConflictBanner) announcementConflictBanner.classList.remove('hidden');
        renderAnnouncementFeedback('warning', 'Publish Conflict', 'Concurrency conflict during publish. Reload the latest draft.');
        return;
      }
      if (publishRes.status !== 'success' && publishRes.status !== 'ok') {
        renderAnnouncementFeedback('error', 'Publish Failed', publishRes.message || 'Database error during publish.');
        return;
      }

      // Success! Update token and active status
      state.announcementHasLoaded = true;
      if (publishRes.draft) state.announcementDraft = publishRes.draft;
      if (publishRes.published) state.announcementPublished = publishRes.published;
      var publishNewToken = publishRes.new_draft_lock_token || publishRes.newToken || currentToken;
      if (publishNewToken) {
        updateAnnouncementTokenBadge(publishNewToken, new Date().toISOString());
      }
      updateAnnouncementBadge(true);
      updateAnnouncementLivePreview();
      renderAnnouncementFeedback('success', 'Announcement Published Live', 'The announcement was published to the live slot and activated sitewide!');
    } catch (err) {
      var msg = err && err.message ? err.message : 'Network error while publishing announcement.';
      renderAnnouncementFeedback('error', 'Publish Failed', msg);
    } finally {
      state.isSavingAnnouncement = false;
      if (btnPublishAnnouncement) btnPublishAnnouncement.disabled = false;
      if (btnPublishAnnouncementLabel) btnPublishAnnouncementLabel.textContent = 'Publish Announcement';
    }
  }

  async function toggleAnnouncementActiveSubmit() {
    var bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (!bridge || !bridge.isAdminVerified()) {
      renderAnnouncementFeedback('error', 'Unauthorized', 'You must be signed in as a blog admin.');
      return;
    }

    var targetActive = !state.announcementIsActive;
    if (btnToggleAnnouncementActive) btnToggleAnnouncementActive.disabled = true;

    try {
      var res = await bridge.toggleAnnouncementActive(targetActive);
      if (res.status === 'ok' || res.status === 'success') {
        state.announcementHasLoaded = true;
        updateAnnouncementBadge(res.is_active);
        renderAnnouncementFeedback('success', 'Status Updated', 'Announcement is now ' + (res.is_active ? 'ACTIVE' : 'DISABLED') + ' sitewide.');
      } else {
        renderAnnouncementFeedback('error', 'Toggle Failed', res.message || 'Could not update announcement active status.');
      }
    } catch (err) {
      var msg = err && err.message ? err.message : 'Network error while updating active status.';
      renderAnnouncementFeedback('error', 'Toggle Failed', msg);
    } finally {
      if (btnToggleAnnouncementActive) btnToggleAnnouncementActive.disabled = false;
    }
  }

  // Announcement event listeners
  if (btnPreviewLangEn) {
    btnPreviewLangEn.addEventListener('click', function () {
      state.announcementPreviewLang = 'en';
      btnPreviewLangEn.className = 'px-2.5 py-1 rounded-md bg-white text-emerald-700 shadow-2xs transition';
      if (btnPreviewLangTl) {
        btnPreviewLangTl.className = 'px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-900 transition';
      }
      updateAnnouncementLivePreview();
    });
  }

  if (btnPreviewLangTl) {
    btnPreviewLangTl.addEventListener('click', function () {
      state.announcementPreviewLang = 'tl';
      btnPreviewLangTl.className = 'px-2.5 py-1 rounded-md bg-white text-emerald-700 shadow-2xs transition';
      if (btnPreviewLangEn) {
        btnPreviewLangEn.className = 'px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-900 transition';
      }
      updateAnnouncementLivePreview();
    });
  }

  [
    inputAnnTitleEn,
    inputAnnBodyEn,
    inputAnnTitleTl,
    inputAnnBodyTl,
    inputAnnImageUrl,
    inputAnnImageAltEn,
    inputAnnImageAltTl,
    inputAnnLinkUrl,
    inputAnnLinkLabelEn,
    inputAnnLinkLabelTl
  ].forEach(function (el) {
    if (el) {
      el.addEventListener('input', updateAnnouncementLivePreview);
    }
  });

  document.querySelectorAll('input[name="announcement-display-style"]').forEach(function (r) {
    r.addEventListener('change', updateAnnouncementLivePreview);
  });

  if (btnSaveAnnouncementDraft) {
    btnSaveAnnouncementDraft.addEventListener('click', function () {
      void saveAnnouncementDraftSubmit();
    });
  }

  if (btnPublishAnnouncement) {
    btnPublishAnnouncement.addEventListener('click', function () {
      void publishAnnouncementSubmit();
    });
  }

  if (btnToggleAnnouncementActive) {
    btnToggleAnnouncementActive.addEventListener('click', function () {
      void toggleAnnouncementActiveSubmit();
    });
  }

  if (btnRefreshAnnouncement) {
    btnRefreshAnnouncement.addEventListener('click', function () {
      void loadAnnouncementFromSupabase();
    });
  }

  if (btnReloadAnnouncementDraft) {
    btnReloadAnnouncementDraft.addEventListener('click', function () {
      void loadAnnouncementFromSupabase();
    });
  }

  if (announcementForm) {
    announcementForm.addEventListener('submit', function (e) {
      e.preventDefault();
    });
  }

  // Initial state setup: avoid overwriting live DOM input or valid sessionStorage draft snapshot
  if (!restoreEditorSnapshotOnInitIfEmpty()) {
    resetEditorForm();
  }
  updateMetrics('all');
  renderTable();
  updateAnnouncementLivePreview();

  // If Supabase admin auth verification already completed before this script initialized, load data now
  if (
    window.__SUWELDOTOOLS_SUPABASE_ADMIN__ &&
    window.__SUWELDOTOOLS_SUPABASE_ADMIN__.isAdminVerified()
  ) {
    void loadPostsFromSupabase();
    void loadAnnouncementFromSupabase();
  }
})();
