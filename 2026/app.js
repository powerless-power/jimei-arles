		(function () {
			var tabBtns = document.querySelectorAll('.tab-btn');
			var tabPanels = {
				guide: document.getElementById('tab-guide'),
				talks: document.getElementById('tab-talks'),
				notes: document.getElementById('tab-notes')
			};

			function switchTab(name) {
				tabBtns.forEach(function (b) {
					b.classList.toggle('active', b.getAttribute('data-tab') === name);
				});
				Object.keys(tabPanels).forEach(function (key) {
					tabPanels[key].classList.toggle('active', key === name);
				});
				window.scrollTo({ top: 0, behavior: 'smooth' });
				if (name === 'notes') {
					window.dispatchEvent(new CustomEvent('notes-tab-shown'));
				}
			}

			tabBtns.forEach(function (btn) {
				btn.addEventListener('click', function () {
					switchTab(btn.getAttribute('data-tab'));
				});
			});

			var venueBtns = document.querySelectorAll('.venue-btn');
			var venuePanels = {
				jimei: document.getElementById('venue-jimei'),
				threeshadows: document.getElementById('venue-threeshadows'),
				archipelago: document.getElementById('venue-archipelago')
			};

			function switchVenue(name) {
				venueBtns.forEach(function (b) {
					b.classList.toggle('active', b.getAttribute('data-venue') === name);
				});
				Object.keys(venuePanels).forEach(function (key) {
					venuePanels[key].classList.toggle('active', key === name);
				});
				window.scrollTo({ top: 0, behavior: 'smooth' });
			}

			venueBtns.forEach(function (btn) {
				btn.addEventListener('click', function () {
					switchVenue(btn.getAttribute('data-venue'));
				});
			});
		})();

		(function () {
			'use strict';

			var DB_NAME = 'jimei-arles-notes';
			var DB_VERSION = 1;
			var MAX_EDGE = 1280;
			var JPEG_QUALITY = 0.8;
			var PDFMAKE_CDN = 'https://cdn.jsdelivr.net/npm/pdfmake@0.3.14/build/pdfmake.min.js';
			var PDF_FONT_REGULAR = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf';
			var PDF_FONT_BOLD = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf';

			var state = {
				db: null,
				available: false,
				items: [],
				byKey: {},
				current: null,
				note: null,
				dirty: false,
				photoUrls: {},
				saveTimer: null,
				toastTimer: null,
				confirmTimer: null,
				pdfLoading: null,
				fontRegistered: false,
				notesRenderId: 0,
				notesUrls: []
			};

			var el = {};

			el.overlay = $('note-overlay');
			el.panel = $('note-panel');
			el.panelTitle = $('note-panel-title');
			el.panelMeta = $('note-panel-meta');
			el.closeBtn = $('note-close');
			el.text = $('note-text');
			el.photos = $('note-photos');
			el.count = $('note-photo-count');
			el.file = $('note-file');
			el.status = $('note-status');
			el.deleteBtn = $('note-delete');
			el.toast = $('note-toast');
			el.progress = $('export-progress');
			el.exportBtn = $('export-notes-btn');
			el.lightbox = $('note-lightbox');
			el.lightboxImg = $('note-lightbox-img');
			el.notesTab = $('tab-notes');
			el.notesList = $('notes-list');
			el.notesEmpty = $('notes-empty');
			el.notesCount = $('notes-count');

			function $(id) {
				return document.getElementById(id);
			}

			function pad(n) {
				return n < 10 ? '0' + n : '' + n;
			}

			function formatTime(ts) {
				var d = new Date(ts);
				return pad(d.getHours()) + ':' + pad(d.getMinutes());
			}

			function formatDate(ts) {
				var d = new Date(ts);
				return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + formatTime(ts);
			}

			function cleanText(s) {
				return (s || '').replace(/\s+/g, ' ').trim();
			}

			function firstText(node) {
				if (!node) return '';
				var first = node.firstChild;
				return cleanText(first && first.nodeType === 3 ? first.nodeValue : node.textContent);
			}

			function toast(msg) {
				el.toast.textContent = msg;
				el.toast.classList.add('show');
				clearTimeout(state.toastTimer);
				state.toastTimer = setTimeout(function () {
					el.toast.classList.remove('show');
				}, 2600);
			}

			function setStatus(text, isError) {
				el.status.textContent = text;
				el.status.classList.toggle('error', !!isError);
			}

			/* ---------- IndexedDB ---------- */

			var DB = {
				open: function () {
					return new Promise(function (resolve, reject) {
						if (!window.indexedDB) {
							reject(new Error('IndexedDB unavailable'));
							return;
						}
						var req = indexedDB.open(DB_NAME, DB_VERSION);
						req.onupgradeneeded = function (e) {
							var db = e.target.result;
							if (!db.objectStoreNames.contains('notes')) {
								db.createObjectStore('notes', { keyPath: 'key' });
							}
							if (!db.objectStoreNames.contains('photos')) {
								db.createObjectStore('photos', { keyPath: 'id' });
							}
						};
						req.onsuccess = function (e) { resolve(e.target.result); };
						req.onerror = function () { reject(req.error || new Error('open failed')); };
						req.onblocked = function () { reject(new Error('IndexedDB blocked')); };
					});
				},
				run: function (storeName, mode, fn) {
					return Promise.resolve(state.db).then(function (db) {
						return new Promise(function (resolve, reject) {
							var tx = db.transaction(storeName, mode);
							var store = tx.objectStore(storeName);
							var out;
							var req = fn(store);
							if (req) {
								req.onsuccess = function () { out = req.result; };
							}
							tx.oncomplete = function () { resolve(out); };
							tx.onerror = function () { reject(tx.error || new Error('transaction failed')); };
							tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
						});
					});
				},
				getAllNotes: function () {
					return this.run('notes', 'readonly', function (s) { return s.getAll(); });
				},
				getNote: function (key) {
					return this.run('notes', 'readonly', function (s) { return s.get(key); });
				},
				putNote: function (note) {
					return this.run('notes', 'readwrite', function (s) { return s.put(note); });
				},
				delNote: function (key) {
					return this.run('notes', 'readwrite', function (s) { return s.delete(key); });
				},
				getPhoto: function (id) {
					return this.run('photos', 'readonly', function (s) { return s.get(id); });
				},
				putPhoto: function (photo) {
					return this.run('photos', 'readwrite', function (s) { return s.put(photo); });
				},
				delPhoto: function (id) {
					return this.run('photos', 'readwrite', function (s) { return s.delete(id); });
				}
			};

			/* ---------- 项目识别 ---------- */

			function makeKey(title) {
				var t = cleanText(title);
				var hash = 0;
				for (var i = 0; i < t.length; i++) {
					hash = ((hash << 5) - hash + t.charCodeAt(i)) | 0;
				}
				var tail = t.replace(/[^\w\u4e00-\u9fff]/g, '').slice(0, 20);
				return 'n' + (hash >>> 0).toString(36) + (tail ? '-' + tail : '');
			}

			function injectButton(item) {
				var btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'note-btn';
				btn.setAttribute('aria-label', '为「' + item.title + '」写笔记');
				btn.innerHTML = '<span class="note-btn-label">写笔记</span><span class="note-dot" aria-hidden="true"></span>';
				btn.addEventListener('click', function (e) {
					e.stopPropagation();
					openPanel(item);
				});
				item.el.appendChild(btn);
				item.btn = btn;
			}

			function registerItems() {
				var used = {};
				var nodes = document.querySelectorAll('.ex-card, .talk-item');
				Array.prototype.forEach.call(nodes, function (node) {
					var isEx = node.classList.contains('ex-card');
					var titleNode = node.querySelector(isEx ? 'h3' : 'h4');
					var title = cleanText(titleNode ? titleNode.textContent : '');
					if (!title) return;

					var meta = '';
					var section = '';
					if (isEx) {
						var venuePanel = node.closest('.venue-panel');
						var venue = venuePanel && venuePanel.querySelector('.venue-head h2')
							? cleanText(venuePanel.querySelector('.venue-head h2').textContent) : '';
						var tag = node.querySelector('.ex-tag');
						var floor = node.closest('.floor-group');
						var badge = floor && floor.querySelector('.badge')
							? cleanText(floor.querySelector('.badge').textContent) : '';
						meta = [venue, cleanText(tag ? tag.textContent : ''), badge].filter(Boolean).join(' · ');
						section = venue || '展览';
					} else {
						var block = node.closest('.day-block');
						var day = block && block.querySelector('.day-head .day')
							? cleanText(block.querySelector('.day-head .day').textContent) : '';
						var date = block && block.querySelector('.day-head .date')
							? cleanText(block.querySelector('.day-head .date').textContent) : '';
						meta = [day, date, firstText(node.querySelector('.talk-time'))].filter(Boolean).join(' · ');
						section = '开幕周活动';
					}

					var base = makeKey(title);
					var key = base;
					var n = 2;
					while (used[key]) {
						key = base + '-' + n;
						n++;
					}
					used[key] = true;

					var item = {
						el: node,
						key: key,
						title: title,
						meta: meta,
						section: section,
						isEx: isEx,
						btn: null
					};
					node.setAttribute('data-note-key', key);
					node.classList.add('note-host');
					injectButton(item);
					state.items.push(item);
					state.byKey[key] = item;
				});
			}

			function hasContent(note) {
				return !!(note && ((note.text && note.text.trim()) || (note.photoIds && note.photoIds.length)));
			}

			function applyNoteIndex(notes) {
				var map = {};
				notes.forEach(function (n) { map[n.key] = n; });
				state.items.forEach(function (item) {
					var has = hasContent(map[item.key]);
					item.btn.classList.toggle('has-note', has);
					item.btn.querySelector('.note-btn-label').textContent = has ? '查看笔记' : '写笔记';
				});
			}

			function updateMark(key) {
				var item = state.byKey[key];
				if (!item || !item.btn) return;
				DB.getNote(key).then(function (note) {
					var has = hasContent(note);
					item.btn.classList.toggle('has-note', has);
					item.btn.querySelector('.note-btn-label').textContent = has ? '查看笔记' : '写笔记';
				}).catch(function () {});
			}

			/* ---------- 笔记预览 ---------- */

			function revokeNotesUrls() {
				state.notesUrls.forEach(function (url) { URL.revokeObjectURL(url); });
				state.notesUrls = [];
			}

			function buildNoteCard(item, note, renderId) {
				var card = document.createElement('article');
				card.className = 'note-card';

				var meta = document.createElement('div');
				meta.className = 'note-card-meta';
				meta.textContent = note.meta || item.meta;
				card.appendChild(meta);

				var title = document.createElement('h3');
				title.className = 'note-card-title';
				title.textContent = note.title || item.title;
				card.appendChild(title);

				if (note.text && note.text.trim()) {
					var text = document.createElement('p');
					text.className = 'note-card-text';
					text.textContent = note.text;
					card.appendChild(text);
				}

				var ids = (note.photoIds || []).slice(0, 4);
				if (ids.length) {
					var strip = document.createElement('div');
					strip.className = 'note-card-photos';
					card.appendChild(strip);
					ids.forEach(function (id) {
						DB.getPhoto(id).then(function (photo) {
							if (renderId !== state.notesRenderId || !photo || !photo.blob) return;
							var url = URL.createObjectURL(photo.blob);
							state.notesUrls.push(url);
							var img = document.createElement('img');
							img.src = url;
							img.alt = photo.name || '笔记照片';
							strip.appendChild(img);
						}).catch(function () {});
					});
				}

				var foot = document.createElement('div');
				foot.className = 'note-card-foot';
				var time = document.createElement('span');
				time.className = 'note-card-time';
				time.textContent = note.updatedAt ? ('更新于 ' + formatDate(note.updatedAt)) : '';
				foot.appendChild(time);
				var edit = document.createElement('button');
				edit.type = 'button';
				edit.className = 'note-card-edit';
				edit.textContent = '查看 / 编辑';
				foot.appendChild(edit);
				card.appendChild(foot);

				card.addEventListener('click', function () { openPanel(item); });
				return card;
			}

			function renderNotesTab() {
				if (!el.notesList) return;
				var renderId = ++state.notesRenderId;
				DB.getAllNotes().then(function (notes) {
					if (renderId !== state.notesRenderId) return;
					var map = {};
					(notes || []).forEach(function (n) { map[n.key] = n; });

					var entries = [];
					state.items.forEach(function (item) {
						var note = map[item.key];
						if (hasContent(note)) entries.push({ item: item, note: note });
					});
					Object.keys(map).forEach(function (key) {
						if (state.byKey[key] || !hasContent(map[key])) return;
						entries.push({
							item: {
								key: key,
								title: map[key].title || '未命名条目',
								meta: map[key].meta || '',
								section: '其他'
							},
							note: map[key]
						});
					});

					el.notesCount.textContent = entries.length;
					el.notesEmpty.hidden = entries.length > 0;
					revokeNotesUrls();
					el.notesList.innerHTML = '';
					entries.forEach(function (entry) {
						el.notesList.appendChild(buildNoteCard(entry.item, entry.note, renderId));
					});
				}).catch(function (err) {
					if (state.available) console.error('[NotesApp] load notes preview failed', err);
					el.notesCount.textContent = '0';
					el.notesEmpty.hidden = false;
					el.notesList.innerHTML = '';
				});
			}

			function refreshNotesTab() {
				if (el.notesTab && el.notesTab.classList.contains('active')) renderNotesTab();
			}

			window.addEventListener('notes-tab-shown', renderNotesTab);

			/* ---------- 编辑面板 ---------- */

			function newNote(item) {
				return {
					key: item.key,
					title: item.title,
					meta: item.meta,
					text: '',
					photoIds: [],
					updatedAt: 0
				};
			}

			function openPanel(item) {
				if (!state.available) {
					toast('浏览器存储不可用，笔记功能无法启用');
					return;
				}
				closePanel(true);
				state.current = item;
				el.panelTitle.textContent = item.title;
				el.panelMeta.textContent = item.meta;
				el.text.value = '';
				el.status.textContent = '';
				el.status.classList.remove('error');
				el.deleteBtn.classList.remove('confirming');
				el.deleteBtn.textContent = '删除笔记';
				el.overlay.classList.add('open');
				el.panel.classList.add('open');
				document.body.style.overflow = 'hidden';

				DB.getNote(item.key).then(function (note) {
					if (!state.current || state.current.key !== item.key) return;
					state.note = (note && typeof note === 'object') ? note : newNote(item);
					state.note.photoIds = state.note.photoIds || [];
					el.text.value = state.note.text || '';
					state.dirty = false;
					setStatus(state.note.updatedAt ? '已保存 ' + formatTime(state.note.updatedAt) : '准备就绪');
					return renderPhotos();
				}).catch(function (err) {
					setStatus('读取失败，请刷新重试', true);
					console.error('[NotesApp] read note failed', err);
				});
			}

			function closePanel(force) {
				clearTimeout(state.saveTimer);
				if (!force && state.current && state.note && state.dirty) {
					saveCurrentNote();
				}
				state.current = null;
				state.note = null;
				state.dirty = false;
				el.overlay.classList.remove('open');
				el.panel.classList.remove('open');
				el.lightbox.classList.remove('show');
				document.body.style.overflow = '';
				el.photos.innerHTML = '';
				revokePhotoUrls();
			}

			function saveCurrentNote() {
				if (!state.current || !state.note) return Promise.resolve(null);
				var item = state.current;
				var note = state.note;
				note.title = item.title;
				note.meta = item.meta;
				note.updatedAt = Date.now();
				setStatus('保存中…');
				return DB.putNote(note).then(function () {
					state.dirty = false;
					setStatus('已保存 ' + formatTime(note.updatedAt));
					updateMark(item.key);
					refreshNotesTab();
					return note;
				}).catch(function (err) {
					setStatus('保存失败，点击重试', true);
					if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
						toast('浏览器存储空间不足，请删除部分照片');
					}
					console.error('[NotesApp] save note failed', err);
					throw err;
				});
			}

			el.text.addEventListener('input', function () {
				if (!state.note) return;
				state.note.text = el.text.value;
				state.dirty = true;
				setStatus('编辑中…');
				clearTimeout(state.saveTimer);
				state.saveTimer = setTimeout(function () {
					saveCurrentNote().catch(function () {});
				}, 500);
			});

			el.status.addEventListener('click', function () {
				if (el.status.classList.contains('error') && state.note) {
					saveCurrentNote().catch(function () {});
				}
			});

			el.closeBtn.addEventListener('click', function () { closePanel(); });
			el.overlay.addEventListener('click', function () { closePanel(); });
			document.addEventListener('keydown', function (e) {
				if (e.keyCode !== 27 && e.key !== 'Escape') return;
				if (el.lightbox.classList.contains('show')) {
					el.lightbox.classList.remove('show');
				} else if (el.panel.classList.contains('open')) {
					closePanel();
				}
			});

			el.deleteBtn.addEventListener('click', function () {
				if (!state.note || !state.current) return;
				if (!el.deleteBtn.classList.contains('confirming')) {
					el.deleteBtn.classList.add('confirming');
					el.deleteBtn.textContent = '确认删除？';
					clearTimeout(state.confirmTimer);
					state.confirmTimer = setTimeout(function () {
						el.deleteBtn.classList.remove('confirming');
						el.deleteBtn.textContent = '删除笔记';
					}, 4000);
					return;
				}
				clearTimeout(state.confirmTimer);
				var key = state.current.key;
				var ids = (state.note.photoIds || []).slice();
				var chain = Promise.resolve();
				ids.forEach(function (id) {
					chain = chain.then(function () { return DB.delPhoto(id); });
				});
				chain.then(function () { return DB.delNote(key); })
					.then(function () {
						clearTimeout(state.saveTimer);
						closePanel(true);
						updateMark(key);
						refreshNotesTab();
						toast('笔记已删除');
					})
					.catch(function (err) {
						toast('删除失败，请重试');
						console.error('[NotesApp] delete failed', err);
					});
			});

			/* ---------- 照片 ---------- */

			function compressImage(file) {
				return new Promise(function (resolve, reject) {
					var reader = new FileReader();
					reader.onerror = function () { reject(reader.error || new Error('read failed')); };
					reader.onload = function () {
						var img = new Image();
						img.onerror = function () { reject(new Error('图片解码失败')); };
						img.onload = function () {
							var w = img.naturalWidth || img.width;
							var h = img.naturalHeight || img.height;
							var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
							var tw = Math.max(1, Math.round(w * scale));
							var th = Math.max(1, Math.round(h * scale));
							var canvas = document.createElement('canvas');
							canvas.width = tw;
							canvas.height = th;
							var ctx = canvas.getContext('2d');
							ctx.fillStyle = '#ffffff';
							ctx.fillRect(0, 0, tw, th);
							ctx.drawImage(img, 0, 0, tw, th);
							canvas.toBlob(function (blob) {
								if (blob) resolve(blob); else reject(new Error('图片压缩失败'));
							}, 'image/jpeg', JPEG_QUALITY);
						};
						img.src = reader.result;
					};
					reader.readAsDataURL(file);
				});
			}

			function revokePhotoUrls() {
				Object.keys(state.photoUrls).forEach(function (id) {
					URL.revokeObjectURL(state.photoUrls[id]);
					delete state.photoUrls[id];
				});
			}

			function renderPhotos() {
				if (!state.current) return Promise.resolve();
				revokePhotoUrls();
				el.photos.innerHTML = '';
				var key = state.current.key;
				var ids = (state.note && state.note.photoIds) || [];
				el.count.textContent = ids.length + ' 张';
				var chain = Promise.resolve();
				ids.forEach(function (id) {
					chain = chain.then(function () {
						return DB.getPhoto(id).then(function (photo) {
							if (!photo || !photo.blob) return;
							if (!state.current || state.current.key !== key) return;
							var url = URL.createObjectURL(photo.blob);
							state.photoUrls[id] = url;
							var wrap = document.createElement('div');
							wrap.className = 'note-photo';
							var img = document.createElement('img');
							img.src = url;
							img.alt = photo.name || '笔记照片';
							img.onerror = function () { wrap.style.opacity = '.35'; };
							img.addEventListener('click', function () {
								el.lightboxImg.src = url;
								el.lightbox.classList.add('show');
							});
							var del = document.createElement('button');
							del.type = 'button';
							del.className = 'note-photo-del';
							del.textContent = '×';
							del.setAttribute('aria-label', '删除照片');
							var armed = false;
							var timer = null;
							del.addEventListener('click', function (e) {
								e.stopPropagation();
								if (!armed) {
									armed = true;
									del.classList.add('confirming');
									del.textContent = '确认';
									timer = setTimeout(function () {
										armed = false;
										del.classList.remove('confirming');
										del.textContent = '×';
									}, 3000);
									return;
								}
								clearTimeout(timer);
								DB.delPhoto(id).then(function () {
									var idx = state.note.photoIds.indexOf(id);
									if (idx >= 0) state.note.photoIds.splice(idx, 1);
									state.dirty = true;
									return saveCurrentNote().then(function () { return renderPhotos(); });
								}).then(function () {
									toast('照片已删除');
								}).catch(function (err) {
									toast('删除失败，请重试');
									console.error('[NotesApp] delete photo failed', err);
								});
							});
							wrap.appendChild(img);
							wrap.appendChild(del);
							el.photos.appendChild(wrap);
						}).catch(function () {});
					});
				});
				return chain;
			}

			el.lightbox.addEventListener('click', function () { el.lightbox.classList.remove('show'); });

			el.file.addEventListener('change', function () {
				var files = Array.prototype.slice.call(el.file.files || []);
				el.file.value = '';
				files = files.filter(function (f) { return /^image\//.test(f.type); });
				if (!files.length) return;
				if (!state.note || !state.current) {
					toast('请先打开一条笔记');
					return;
				}
				setStatus('正在处理照片…');
				var chain = Promise.resolve();
				files.forEach(function (file) {
					chain = chain.then(function () {
						return compressImage(file).then(function (blob) {
							var photo = {
								id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
								noteKey: state.current.key,
								blob: blob,
								name: file.name || 'photo.jpg',
								createdAt: Date.now()
							};
							return DB.putPhoto(photo).then(function () {
								state.note.photoIds.push(photo.id);
								state.dirty = true;
							});
						});
					});
				});
				chain.then(function () { return saveCurrentNote(); })
					.then(function () { return renderPhotos(); })
					.then(function () { toast('照片已保存到本地'); })
					.catch(function (err) {
						setStatus('照片保存失败，请重试', true);
						toast('照片保存失败，请重试');
						console.error('[NotesApp] photo save failed', err);
					});
			});

			/* ---------- PDF 导出 ---------- */

			function loadScript(src) {
				return new Promise(function (resolve, reject) {
					var s = document.createElement('script');
					s.src = src;
					s.async = true;
					s.onload = function () { resolve(); };
					s.onerror = function () { reject(new Error('CDN 加载失败')); };
					document.head.appendChild(s);
				});
			}

			function readBlobAsDataUrl(blob) {
				return new Promise(function (resolve, reject) {
					var reader = new FileReader();
					reader.onerror = function () { reject(new Error('文件读取失败')); };
					reader.onload = function () { resolve(reader.result); };
					reader.readAsDataURL(blob);
				});
			}

			function loadPdfLib() {
				if (state.pdfLoading) return state.pdfLoading;
				state.pdfLoading = (window.pdfMake ? Promise.resolve() : loadScript(PDFMAKE_CDN))
					.then(function () {
						if (!window.pdfMake) throw new Error('CDN 加载失败');
						if (!state.fontRegistered) {
							pdfMake.addFonts({
								NotoSansSC: {
									normal: PDF_FONT_REGULAR,
									bold: PDF_FONT_BOLD,
									italics: PDF_FONT_REGULAR,
									bolditalics: PDF_FONT_BOLD
								}
							});
							state.fontRegistered = true;
						}
					}).catch(function (err) {
						state.pdfLoading = null;
						throw err;
					});
				return state.pdfLoading;
			}

			function buildDocDefinition(notes) {
				var map = {};
				notes.forEach(function (n) { map[n.key] = n; });

				var photoIds = [];
				notes.forEach(function (note) {
					(note.photoIds || []).forEach(function (id) {
						if (photoIds.indexOf(id) < 0) photoIds.push(id);
					});
				});

				var photos = {};
				var photoTasks = photoIds.map(function (id) {
					return DB.getPhoto(id).then(function (photo) {
						if (!photo || !photo.blob) return null;
						return readBlobAsDataUrl(photo.blob);
					}).then(function (dataUrl) {
						if (dataUrl) photos[id] = dataUrl;
					}).catch(function () {});
				});

				return Promise.all(photoTasks).then(function () {
					var content = [
						{ text: '我的观展笔记', fontSize: 24, bold: true, margin: [0, 0, 0, 6] },
						{ text: '2026 集美·阿尔勒影像艺术季 · 导出于 ' + formatDate(Date.now()), fontSize: 10, color: '#6e6e73', margin: [0, 0, 0, 12] },
						{ canvas: [{ type: 'rect', x: 0, y: 0, w: 40, h: 2, color: '#b54a3a' }], margin: [0, 0, 0, 18] }
					];

					var lastSection = '';
					state.items.forEach(function (item) {
						var note = map[item.key];
						if (!hasContent(note)) return;

						if (item.section !== lastSection) {
							content.push({
								text: item.section,
								fontSize: 14,
								bold: true,
								color: '#b54a3a',
								margin: [0, 14, 0, 8]
							});
							lastSection = item.section;
						}

						var stack = [
							{ text: note.meta || item.meta, fontSize: 9, color: '#a1a1a6', margin: [0, 0, 0, 3] },
							{ text: note.title || item.title, fontSize: 14, bold: true, margin: [0, 0, 0, 6] }
						];

						if (note.text && note.text.trim()) {
							stack.push({ text: note.text, fontSize: 10.5, color: '#3a3a3c', lineHeight: 1.6 });
						}

						var images = [];
						(note.photoIds || []).forEach(function (id) {
							if (photos[id]) {
								images.push({ image: photos[id], width: 120, margin: [0, 8, 8, 0] });
							}
						});
						if (images.length) {
							stack.push({ columns: images, columnGap: 8 });
						}

						content.push({
							stack: stack,
							margin: [0, 0, 0, 16],
							pageBreak: 'avoid'
						});
					});

					return {
						pageSize: 'A4',
						pageMargins: [40, 44, 40, 44],
						defaultStyle: { font: 'NotoSansSC', fontSize: 10.5, color: '#1c1c1e' },
						content: content
					};
				});
			}

			function exportPDF() {
				if (!state.available) {
					toast('浏览器存储不可用，无法导出');
					return;
				}
				if (el.exportBtn.classList.contains('busy')) return;
				el.exportBtn.classList.add('busy');
				el.progress.classList.add('show');

				DB.getAllNotes().then(function (notes) {
					var active = (notes || []).filter(hasContent);
					if (!active.length) return { empty: true };
					return Promise.all([
						loadPdfLib(),
						buildDocDefinition(active)
					]).then(function (results) {
						return pdfMake.createPdf(results[1]).download('集美阿尔勒2026-我的笔记.pdf');
					});
				}).then(function (res) {
					el.exportBtn.classList.remove('busy');
					el.progress.classList.remove('show');
					if (!res || !res.empty) toast('PDF 已导出');
				}).catch(function (err) {
					el.exportBtn.classList.remove('busy');
					el.progress.classList.remove('show');
					var msg = (err && err.message === 'CDN 加载失败')
						? '导出组件加载失败，请联网后重试'
						: '导出失败，请重试';
					toast(msg);
					console.error('[NotesApp] export failed', err);
				});
			}

			el.exportBtn.addEventListener('click', exportPDF);

			/* ---------- 启动 ---------- */

			function init() {
				registerItems();

				DB.open().then(function (db) {
					state.db = db;
					state.available = true;
					return DB.getAllNotes();
				}).then(function (notes) {
					applyNoteIndex(notes || []);
				}).catch(function (err) {
					state.available = false;
					state.items.forEach(function (item) {
						item.btn.classList.add('disabled');
						item.btn.title = '浏览器存储不可用，无法保存笔记';
					});
					el.exportBtn.classList.add('disabled');
					el.exportBtn.title = '浏览器存储不可用，无法导出';
					console.warn('[NotesApp] IndexedDB unavailable', err);
				});
			}

			init();
		})();

		(function () {
			'use strict';

			var subscribeLink = document.querySelector('[data-calendar-subscribe]');
			var downloadLink = document.querySelector('[data-calendar-download]');
			var copyBtn = document.querySelector('[data-calendar-copy]');
			var urlNode = document.querySelector('[data-calendar-url]');
			var urlBox = urlNode && urlNode.parentElement;
			var hint = document.querySelector('[data-calendar-hint]');
			if (!subscribeLink || !downloadLink || !copyBtn || !urlNode || !urlBox || !hint) return;

			var icsUrl;
			try {
				icsUrl = new URL('opening-week.ics', location.href).href;
			} catch (e) {
				return;
			}

			var remote = /^https?:\/\//.test(icsUrl);
			if (remote) {
				subscribeLink.href = icsUrl.replace(/^https?:\/\//, 'webcal://');
				subscribeLink.title = '在日历应用中订阅 ' + icsUrl;
				downloadLink.href = icsUrl;
				urlNode.textContent = icsUrl;
				subscribeLink.hidden = false;
				copyBtn.hidden = false;
				urlBox.hidden = false;
				hint.hidden = true;
			} else {
				downloadLink.href = 'opening-week.ics';
				subscribeLink.hidden = true;
				copyBtn.hidden = true;
				urlBox.hidden = true;
				hint.hidden = false;
			}

			function copyText(text) {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					return navigator.clipboard.writeText(text);
				}
				return new Promise(function (resolve, reject) {
					var ta = document.createElement('textarea');
					ta.value = text;
					ta.setAttribute('readonly', '');
					ta.style.position = 'fixed';
					ta.style.top = '-1000px';
					document.body.appendChild(ta);
					ta.select();
					var ok = false;
					try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
					document.body.removeChild(ta);
					if (ok) resolve(); else reject(new Error('copy failed'));
				});
			}

			copyBtn.addEventListener('click', function () {
				copyText(icsUrl).then(function () {
					var previous = copyBtn.textContent;
					copyBtn.textContent = '已复制';
					setTimeout(function () { copyBtn.textContent = previous; }, 1600);
				}).catch(function () {
					var previous = copyBtn.textContent;
					copyBtn.textContent = '复制失败，请手动选择';
					setTimeout(function () { copyBtn.textContent = previous; }, 2200);
				});
			});
		})();
	