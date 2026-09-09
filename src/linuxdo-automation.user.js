// ==UserScript==
// @name         Linux.do 自动浏览助手
// @namespace    https://linux.do/
// @version      2.5.0
// @description  自动浏览帖子、滚动查看所有回复、随机点赞、避免重复浏览、可限定每帖浏览楼层数、Credit积分展示
// @author       Assistant
// @match        https://linux.do/*
// @downloadURL  https://raw.githubusercontent.com/liasica/linuxdo/feature/src/linuxdo-automation.user.js
// @updateURL    https://raw.githubusercontent.com/liasica/linuxdo/feature/src/linuxdo-automation.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      credit.linux.do
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // 为当前标签页生成唯一ID（用于防多开检测）
  // 必须按“浏览器标签页”稳定，不能每次页面加载都随机：脚本靠整页跳转翻话题，
  // 若跳转后 ID 变了，锁里存的旧 ID 永远对不上自己，会被误判成“其他标签页在运行”而拒绝自启。
  // sessionStorage 恰好按标签页隔离且整页跳转后保留：同一标签页翻页 ID 不变，新开标签页 ID 必然不同
  const TAB_ID = (() => {
    try {
      let id = sessionStorage.getItem('linuxdo_tab_id');
      if (!id) {
        id = Math.random().toString(36).slice(2, 11);
        sessionStorage.setItem('linuxdo_tab_id', id);
      }
      return id;
    } catch (e) {
      // sessionStorage 不可用时退回随机 ID（仅影响防多开的准确性，不影响功能）
      return Math.random().toString(36).slice(2, 11);
    }
  })();

  // ==================== 配置参数 ====================

  // 速度预设（进一步调整避免429错误）
  const SPEED_PRESETS = {
    slow: {
      name: '慢速',
      scrollStep: 300,
      scrollInterval: 2500,
      loadWaitTime: 4000,
      minReadTime: 2000,
      maxReadTime: 4000,
      noNewContentRetry: 4
    },
    normal: {
      name: '正常',
      scrollStep: 400,
      scrollInterval: 1500,
      loadWaitTime: 2500,
      minReadTime: 800,
      maxReadTime: 1500,
      noNewContentRetry: 3
    },
    fast: {
      name: '快速',
      scrollStep: 500,
      scrollInterval: 800,
      loadWaitTime: 1500,
      minReadTime: 300,
      maxReadTime: 800,
      noNewContentRetry: 3
    },
    turbo: {
      name: '极速',
      scrollStep: 600,
      scrollInterval: 400,
      loadWaitTime: 1000,
      minReadTime: 100,
      maxReadTime: 300,
      noNewContentRetry: 2
    }
  };

  // 当前速度设置（延迟初始化，等Storage类定义后再读取）
  let currentSpeed = 'normal';

  // 列表选择设置
  const LIST_OPTIONS = {
    latest: { name: '最新', path: '/latest' },
    new: { name: '新帖', path: '/new' },
    unread: { name: '未读', path: '/unread' }
  };
  let currentList = 'latest';

  // 点赞开关
  let enableLike = true;

  // 点赞概率预设
  const LIKE_CHANCE_PRESETS = {
    low: { name: '低', value: 0.05 },      // 5%
    medium: { name: '中', value: 0.15 },   // 15%
    high: { name: '高', value: 0.25 },     // 25%
    veryHigh: { name: '极高', value: 0.40 } // 40%
  };
  let currentLikeChance = 'medium';

  // 楼层限制：每帖只浏览前 N 楼就换下一帖，0 表示不限
  let floorLimit = 0;
  // 楼层限制的计数口径：开启后已读楼层滚过不计数，只数上次阅读位置之后的新楼层
  let floorLimitUnreadOnly = false;

  const CONFIG = {
    // 动态从速度预设获取
    get scrollStep() { return SPEED_PRESETS[currentSpeed].scrollStep; },
    get scrollInterval() { return SPEED_PRESETS[currentSpeed].scrollInterval; },
    get loadWaitTime() { return SPEED_PRESETS[currentSpeed].loadWaitTime; },
    get minReadTime() { return SPEED_PRESETS[currentSpeed].minReadTime; },
    get maxReadTime() { return SPEED_PRESETS[currentSpeed].maxReadTime; },
    get noNewContentRetry() { return SPEED_PRESETS[currentSpeed].noNewContentRetry; },

    // 点赞设置（动态从预设获取）
    get likeChance() { return LIKE_CHANCE_PRESETS[currentLikeChance].value; },
    minLikeInterval: 2000,        // 最小点赞间隔 (ms)

    // 会话设置
    maxLikesPerSession: 50,       // 每次会话最大点赞数
    maxTopicsPerSession: 50,      // 每次会话最大浏览话题数

    // 返回列表设置
    returnToListDelay: 1000,      // 返回列表前延迟 (ms)

    // 时间线「返回」按钮的最长等待时间 (ms)，等不到就留在原地读
    backButtonWaitTime: 2500,

    // 调试（默认关闭，避免给所有用户刷 console；需要时用 GM_setValue('debug', true) 开启）
    debug: false
  };

  function setSpeed(preset) {
    if (SPEED_PRESETS[preset]) {
      currentSpeed = preset;
      Storage.set('speed_preset', preset);
      log(`速度设置为: ${SPEED_PRESETS[preset].name}`);
    }
  }

  function setList(listType) {
    if (LIST_OPTIONS[listType]) {
      currentList = listType;
      Storage.set('list_type', listType);
      log(`列表设置为: ${LIST_OPTIONS[listType].name}`);
    }
  }

  function setEnableLike(enabled, updateUI = true) {
    enableLike = enabled;
    Storage.set('enable_like', enabled);
    log(`随机点赞: ${enabled ? '已开启' : '已关闭'}`);

    // 更新UI按钮状态
    if (updateUI) {
      document.querySelectorAll('.like-btn[data-like]').forEach(btn => {
        btn.classList.remove('active');
        if ((btn.dataset.like === 'true') === enabled) {
          btn.classList.add('active');
        }
      });
      // 点赞关闭时概率选项没有意义，整行收起
      const chanceRow = document.getElementById('like-chance-row');
      if (chanceRow) chanceRow.classList.toggle('hidden', !enabled);
    }
  }

  // 处理点赞限制：点赞走 API 直连（sendLikeRequest），命中 429/rate_limit 时调用，
  // 直接关掉点赞开关避免继续触发风控（API 点赞不弹 UI 对话框，故无需检测或关闭弹窗）
  function handleLikeLimit() {
    log('已达到点赞上限，自动关闭点赞功能');
    setEnableLike(false, true);
  }

  function setLikeChance(preset) {
    if (LIKE_CHANCE_PRESETS[preset]) {
      currentLikeChance = preset;
      Storage.set('like_chance', preset);
      const percent = Math.round(LIKE_CHANCE_PRESETS[preset].value * 100);
      log(`点赞概率设置为: ${LIKE_CHANCE_PRESETS[preset].name} (${percent}%)`);
    }
  }

  function setFloorLimit(value) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    floorLimit = n;
    Storage.set('floor_limit', n);
    log(`楼层限制设置为: ${n > 0 ? `前 ${n} 楼` : '不限'}`);
  }

  function setFloorLimitUnreadOnly(enabled) {
    floorLimitUnreadOnly = enabled;
    Storage.set('floor_limit_unread_only', enabled);
    log(`楼层限制口径: ${enabled ? '只计未读楼层' : '按楼层号'}`);
  }

  // ==================== 工具函数 ====================

  function log(...args) {
    if (CONFIG.debug) {
      console.log(`[LinuxDo自动化|${TAB_ID}]`, new Date().toLocaleTimeString(), ...args);
    }
  }

  function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // 登录状态三态检测：true=已登录，false=未登录，null=无法判定（页面未就绪或 Cloudflare 挑战页）
  // 优先读取 #data-preloaded（服务端直出，脚本注入时必然存在），
  // 避免与 Ember 渲染 #current-user 竞速导致误判（脚本注入时 header 尚未渲染）
  function getLoginState() {
    const preloaded = document.querySelector('#data-preloaded');
    if (preloaded) {
      // 新版 Discourse 把预加载数据放进 <script id="data-preloaded" type="application/json"> 的文本内容里；
      // 旧版是 <div id="data-preloaded" data-preloaded="{...}">。先取 textContent，再回退 dataset 兼容旧版
      const raw = preloaded.textContent || preloaded.dataset.preloaded;
      if (raw) {
        try {
          return 'currentUser' in JSON.parse(raw);
        } catch (e) {
          // 解析失败，回退到 DOM 检测
        }
      }
    }
    return document.querySelector('#current-user') !== null ? true : null;
  }

  function getPageTypeFromPath(path) {
    if (path.match(/^\/t\/topic\/\d+/)) return 'topic';
    if (path === '/latest' || path === '/new' || path === '/unread' ||
        path === '/' || path === '/top' || path === '/hot' ||
        path.startsWith('/c/')) return 'list';
    return 'other';
  }

  function getPageType() {
    return getPageTypeFromPath(window.location.pathname);
  }

  function getTopicIdFromUrl(url) {
    const match = url?.match(/\/t\/topic\/(\d+)/);
    return match ? match[1] : null;
  }

  function getCurrentTopicId() {
    return getTopicIdFromUrl(window.location.pathname);
  }

  // 读取当前话题「上次读到第几楼」（Discourse 的 last_read_post_number）
  // 数据取自服务端直出的 #data-preloaded：它是 <script type="application/json">，
  // 数据在 textContent 里，且话题对象被二次 JSON 编码（顶层 value 本身是字符串）
  // 未登录、非话题页或该帖从未读过时返回 0
  function getLastReadPostNumber(topicId) {
    try {
      const el = document.querySelector('#data-preloaded');
      if (!el) return 0;
      const raw = JSON.parse(el.textContent)[`topic_${topicId}`];
      if (!raw) return 0;
      const topic = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Number(topic.last_read_post_number) || 0;
    } catch (e) {
      return 0;
    }
  }

  // Discourse 的「返回」按钮（i18n 键 topic.timeline.back，悬浮提示「返回上一个未读帖子」），
  // 点击等价于 jumpToPost(topic.last_read_post_number)，即跳回上次读到的楼层。
  // 宽屏渲染在右侧时间线的 scroller 内 (button.back-button)，
  // 窄屏/移动端渲染在底部进度条上 (button.progress-back)，两处都兜住
  const BACK_BUTTON_SELECTOR = [
    '.topic-timeline button.back-button',
    '.timeline-container button.back-button',
    '#topic-progress-wrapper button.progress-back',
    '.progress-back-container button.progress-back'
  ].join(', ');

  // 时间线由 Ember 异步渲染，且「返回」只在当前位置落后于上次阅读位置时才出现，
  // 所以轮询等待而不是取一次就走；超时返回 null，由调用方决定退路
  async function waitForBackButton(timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const btn = document.querySelector(BACK_BUTTON_SELECTOR);
      if (btn && btn.offsetParent !== null) return btn;
      await randomDelay(200, 350);
    }
    return null;
  }

  // ==================== 存储管理 ====================

  class Storage {
    static get(key, defaultValue = null) {
      try {
        if (typeof GM_getValue !== 'undefined') {
          const val = GM_getValue(key, null);
          return val !== null ? val : defaultValue;
        }
        const value = localStorage.getItem(`linuxdo_${key}`);
        return value ? JSON.parse(value) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    }

    static set(key, value) {
      try {
        if (typeof GM_setValue !== 'undefined') {
          GM_setValue(key, value);
        } else {
          localStorage.setItem(`linuxdo_${key}`, JSON.stringify(value));
        }
      } catch (e) {
        log('存储失败:', e);
      }
    }
  }

  // 初始化设置
  currentSpeed = Storage.get('speed_preset', 'normal');
  currentList = Storage.get('list_type', 'latest');
  enableLike = Storage.get('enable_like', true);
  currentLikeChance = Storage.get('like_chance', 'medium');
  floorLimit = Storage.get('floor_limit', 0);
  floorLimitUnreadOnly = Storage.get('floor_limit_unread_only', false);
  CONFIG.debug = Storage.get('debug', false);

  // 数据迁移：v2.1.1 起 liked_posts 的键从话题内楼层序号改为全局 post id，
  // 旧键在新逻辑下全部失配（脏数据），一次性清空，避免重访旧话题时把已点赞的帖子误 toggle 取消
  // （viewed_topics 存的一直是话题 id，语义未变，保留不动）
  const STORAGE_VERSION = 2;
  if (Storage.get('storage_version', 1) < STORAGE_VERSION) {
    Storage.set('liked_posts', []);
    Storage.set('storage_version', STORAGE_VERSION);
    log('存储迁移：已重置 liked_posts (点赞去重键格式变更为全局 post id)');
  }

  // ==================== 浏览记录管理 ====================

  // 浏览/点赞记录的最大保留条数，超出后按插入顺序淘汰最旧的，避免长期运行无限膨胀
  const MAX_HISTORY = 5000;

  // 将 Set 裁剪到不超过 max 条：Set 迭代按插入顺序，从头部删除即淘汰最旧的
  function trimSet(set, max) {
    while (set.size > max) {
      set.delete(set.values().next().value);
    }
  }

  class BrowsingHistory {
    constructor() {
      this.viewed = new Set(Storage.get('viewed_topics', []));
      this.liked = new Set(Storage.get('liked_posts', []));
      this.sessionViewed = 0;
      this.sessionLiked = 0;
      this.sessionReplies = 0;
      this.totalReplies = Storage.get('total_replies', 0);
      // 节流写入的定时器句柄，避免每标记一条就全量序列化落盘
      this.saveTimer = null;
    }

    isTopicViewed(topicId) {
      return this.viewed.has(String(topicId));
    }

    markTopicViewed(topicId) {
      const id = String(topicId);
      if (!this.viewed.has(id)) {
        this.viewed.add(id);
        trimSet(this.viewed, MAX_HISTORY);
        this.sessionViewed++;
        this.scheduleSave();
        log(`标记话题 ${id} 为已浏览，本次会话已浏览 ${this.sessionViewed} 个`);
      }
    }

    isPostLiked(postId) {
      return this.liked.has(String(postId));
    }

    markPostLiked(postId) {
      const id = String(postId);
      if (!this.liked.has(id)) {
        this.liked.add(id);
        trimSet(this.liked, MAX_HISTORY);
        this.sessionLiked++;
        this.scheduleSave();
      }
    }

    addReplyViewed() {
      this.sessionReplies++;
      this.totalReplies++;
      if (this.sessionReplies % 10 === 0) {
        this.scheduleSave();
      }
    }

    // 节流写入：合并短时间内的多次变更，最多延迟 2 秒统一落盘
    // 页面卸载时由 beforeunload 调用 save() 兜底 flush，避免翻页丢失最后的记录
    scheduleSave() {
      if (this.saveTimer) return;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.save();
      }, 2000);
    }

    save() {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      Storage.set('viewed_topics', [...this.viewed]);
      Storage.set('liked_posts', [...this.liked]);
      Storage.set('total_replies', this.totalReplies);
    }

    // 仅在有节流待写数据时落盘，供 beforeunload 兜底 flush
    // 无变更的页面（未启动/未登录/路过） saveTimer 为 null，不写，避免用可能读空的数据覆盖已有历史
    flushPending() {
      if (this.saveTimer) this.save();
    }

    clearHistory() {
      this.viewed.clear();
      this.liked.clear();
      this.totalReplies = 0;
      this.save();
      log('已清除所有浏览历史');
    }

    getStats() {
      return {
        totalViewed: this.viewed.size,
        totalLiked: this.liked.size,
        sessionViewed: this.sessionViewed,
        sessionLiked: this.sessionLiked,
        sessionReplies: this.sessionReplies,
        totalReplies: this.totalReplies
      };
    }

    canContinue() {
      return this.sessionViewed < CONFIG.maxTopicsPerSession &&
             this.sessionLiked < CONFIG.maxLikesPerSession;
    }
  }

  // ==================== 阅读量统计 ====================

  // 监听 Discourse 的 /topics/timings 阅读上报接口，请求成功即计入阅读量。
  // 上报体格式：timings[楼层号]=毫秒&...&topic_time=毫秒&topic_id=话题ID。
  // 同一楼层长时间停留会被 Discourse 分多次重复上报，因此按「话题ID:楼层号」
  // 去重累计，与 linux.do 个人资料页「阅读的帖子数」口径一致。
  // 计数持久化存储，页面刷新/跳转后延续；仅在手动点击「开始」时清零。
  // 存储跨标签页共享：写回前先与存储对齐（见 syncFromStorage），避免本页
  // 旧快照覆盖其他标签页的新增，或清零后被其他标签页的旧数据写回
  class ReadingTracker {
    constructor() {
      this.epoch = Storage.get('session_read_epoch', 0);
      this.readKeys = new Set(Storage.get('session_read_keys', []));
      this.onUpdate = null;
    }

    get count() {
      return this.readKeys.size;
    }

    addFromBody(body) {
      try {
        const params = new URLSearchParams(body);
        const topicId = params.get('topic_id');
        if (!topicId) return;

        const newKeys = [];
        for (const [key, value] of params.entries()) {
          // 校验条目格式：楼层号与阅读毫秒数都必须是纯数字，异常条目不计入
          const match = key.match(/^timings\[(\d+)\]$/);
          if (match && /^\d+$/.test(value)) newKeys.push(`${topicId}:${match[1]}`);
        }
        if (newKeys.length === 0) return;

        this.syncFromStorage();
        let added = 0;
        for (const readKey of newKeys) {
          if (!this.readKeys.has(readKey)) {
            this.readKeys.add(readKey);
            added++;
          }
        }
        if (added > 0) {
          Storage.set('session_read_keys', [...this.readKeys]);
          log(`阅读上报成功，新增 ${added} 条，本次总阅读量 ${this.count}`);
        }
        this.onUpdate?.();
      } catch (e) {
        log('解析 timings 上报数据失败:', e);
      }
    }

    // 与存储对齐：epoch 变化说明其他标签页清零过，丢弃本页内存中的旧数据；
    // 同一 epoch 则与存储做并集，防止用本页旧快照覆盖其他标签页写入的新增
    syncFromStorage() {
      const storedEpoch = Storage.get('session_read_epoch', 0);
      const storedKeys = Storage.get('session_read_keys', []);
      if (storedEpoch !== this.epoch) {
        this.epoch = storedEpoch;
        this.readKeys = new Set(storedKeys);
      } else {
        for (const key of storedKeys) this.readKeys.add(key);
      }
    }

    reset() {
      this.epoch = Date.now();
      this.readKeys.clear();
      Storage.set('session_read_epoch', this.epoch);
      Storage.set('session_read_keys', []);
      this.onUpdate?.();
      log('本次总阅读量已清零');
    }
  }

  const readingTracker = new ReadingTracker();

  // 拦截 XHR 与 fetch 两条通道的 /topics/timings 上报，响应 2xx 才计数。
  // hook 必须装在页面真实 window（unsafeWindow）上：带 @grant 的脚本运行在
  // 脚本管理器沙箱中，改写沙箱自己的 XMLHttpRequest/fetch 拦截不到页面请求
  function installTimingsHook() {
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const TIMINGS_PATH = '/topics/timings';
    const isTimingsUrl = (url) => String(url).includes(TIMINGS_PATH);
    // 沙箱与页面可能不同 realm，不能用 instanceof Request，按结构判断
    const isRequestLike = (v) => !!v && typeof v === 'object' &&
      typeof v.url === 'string' && typeof v.clone === 'function';

    const xhrProto = pageWindow.XMLHttpRequest.prototype;
    const originalOpen = xhrProto.open;
    const originalSend = xhrProto.send;

    xhrProto.open = function(method, url) {
      this._isTimingsRequest = isTimingsUrl(url);
      return originalOpen.apply(this, arguments);
    };

    xhrProto.send = function(body) {
      if (this._isTimingsRequest) {
        this.addEventListener('load', function() {
          if (this.status >= 200 && this.status < 300) {
            readingTracker.addFromBody(body);
          }
        });
      }
      return originalSend.apply(this, arguments);
    };

    const originalFetch = pageWindow.fetch;
    pageWindow.fetch = function(input, init) {
      const url = isRequestLike(input) ? input.url : input;
      if (!isTimingsUrl(url)) {
        return originalFetch.apply(this, arguments);
      }

      // body 可能在 init 上，也可能包在 Request 对象里（后者需 clone 读取）
      const bodyPromise = init?.body !== undefined && init?.body !== null
        ? Promise.resolve(init.body)
        : (isRequestLike(input) ? input.clone().text().catch(() => null) : Promise.resolve(null));

      return originalFetch.apply(this, arguments).then(response => {
        if (response.ok) {
          bodyPromise.then(body => {
            if (body) readingTracker.addFromBody(body);
          });
        }
        return response;
      });
    };
  }

  // ==================== Credit 积分查询 ====================

  // 从 credit.linux.do 拉取 Credit（LDC）余额与每日收支，展示在控制面板。
  // 认证依赖浏览器里 credit.linux.do 的 OAuth cookie（用户登录过 https://credit.linux.do 即可用），
  // 因此必须走 GM_xmlhttpRequest（携带该域 cookie），页面内 fetch 是 linux.do 域、带不过去。
  // 命中 429 时进入冷却期，冷却结束前直接用缓存，避免反复触发风控。
  const CREDIT_MIN_INTERVAL = 5 * 60 * 1000;   // 常规刷新最小间隔：5 分钟
  const CREDIT_COOLDOWN_429 = 30 * 60 * 1000;  // 触发 429 后的冷却期：30 分钟

  class CreditTracker {
    constructor() {
      // 刷新节流状态持久化，跨页面跳转（脚本随 Discourse 整页导航重新注入）依然生效
      this.lastFetch = Storage.get('credit_last_fetch', 0);
      this.cooldownUntil = Storage.get('credit_cooldown_until', 0);
      this.cachedData = Storage.get('credit_cache', null);
      this.fetching = false;
    }

    // 拉取并返回数据；任何失败路径都 resolve(null)，由调用方决定回退展示
    fetch(force = false) {
      const now = Date.now();
      if (this.fetching) return Promise.resolve(this.cachedData);
      if (!force && this.cooldownUntil > now) return Promise.resolve(this.cachedData);
      if (!force && this.lastFetch > 0 && now - this.lastFetch < CREDIT_MIN_INTERVAL) {
        return Promise.resolve(this.cachedData);
      }

      this.fetching = true;
      return this.requestUserInfo()
        .then(userData => {
          if (!userData) return this.cachedData;
          this.lastFetch = now;
          this.cooldownUntil = 0;
          this.cachedData = {
            username: userData.nickname || userData.username || '',
            available: userData.available_balance ?? '0',
            community: userData.community_balance ?? '0',
            remainQuota: userData.remain_quota ?? '0',
            totalReceive: userData.total_receive ?? '0',
            totalPayment: userData.total_payment ?? '0',
            fetchTime: now
          };
          Storage.set('credit_cache', this.cachedData);
          Storage.set('credit_last_fetch', now);
          Storage.set('credit_cooldown_until', 0);
          return this.cachedData;
        })
        .catch(err => {
          log('[Credit] 拉取失败:', err?.message || err);
          if (err?.rateLimited) {
            this.cooldownUntil = now + CREDIT_COOLDOWN_429;
            Storage.set('credit_cooldown_until', this.cooldownUntil);
          }
          return this.cachedData;
        })
        .finally(() => { this.fetching = false; });
    }

    // credit.linux.do 的 OAuth 用户信息接口；401/403 表示未登录 credit 站
    requestUserInfo() {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'undefined') {
          reject(new Error('GM_xmlhttpRequest 不可用'));
          return;
        }
        GM_xmlhttpRequest({
          method: 'GET',
          url: 'https://credit.linux.do/api/v1/oauth/user-info',
          timeout: 15000,
          headers: {
            'Accept': 'application/json',
            'Referer': 'https://credit.linux.do/home',
            'Origin': 'https://credit.linux.do'
          },
          onload: (response) => {
            if (response.status === 200) {
              try {
                const json = JSON.parse(response.responseText);
                resolve(json?.data || null);
              } catch (e) {
                reject(new Error('响应解析失败'));
              }
            } else if (response.status === 401 || response.status === 403) {
              // 未登录 credit 站不算错误，静默返回 null（面板显示"未绑定"）
              resolve(null);
            } else if (response.status === 429) {
              const err = new Error('rate limited');
              err.rateLimited = true;
              reject(err);
            } else {
              reject(new Error(`HTTP ${response.status}`));
            }
          },
          onerror: () => reject(new Error('网络错误')),
          ontimeout: () => reject(new Error('请求超时'))
        });
      });
    }

    // 格式化余额显示：大数缩写（12.3k），保持面板紧凑
    static formatAmount(value) {
      const num = parseFloat(value);
      if (isNaN(num)) return String(value ?? '0');
      if (Math.abs(num) >= 100000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      return String(Math.round(num * 100) / 100);
    }
  }

  // 懒加载单例：仅在面板展开（createControlPanel）后才会真正发请求
  let creditTracker = null;

  // ==================== 滚动控制器 ====================

  class ScrollController {
    constructor() {
      this.lastScrollHeight = 0;
      this.noNewContentCount = 0;
    }

    getScrollInfo() {
      return {
        scrollTop: window.pageYOffset || document.documentElement.scrollTop,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight
      };
    }

    isAtBottom() {
      const { scrollTop, scrollHeight, clientHeight } = this.getScrollInfo();
      return scrollTop + clientHeight >= scrollHeight - 100;
    }

    isAtTop() {
      return this.getScrollInfo().scrollTop < 100;
    }

    async scrollDown() {
      const scrollAmount = CONFIG.scrollStep + randomInt(-30, 30);
      window.scrollBy({
        top: scrollAmount,
        behavior: 'auto'
      });
    }

    async scrollToTop() {
      window.scrollTo({ top: 0, behavior: 'auto' });
      await randomDelay(200, 400);
    }

    hasNewContent() {
      const currentHeight = document.documentElement.scrollHeight;
      if (currentHeight > this.lastScrollHeight) {
        this.lastScrollHeight = currentHeight;
        this.noNewContentCount = 0;
        return true;
      }
      this.noNewContentCount++;
      return false;
    }

    isContentFullyLoaded() {
      return this.noNewContentCount >= CONFIG.noNewContentRetry;
    }

    reset() {
      this.lastScrollHeight = document.documentElement.scrollHeight;
      this.noNewContentCount = 0;
    }
  }

  // ==================== 帖子详情页浏览器 ====================

  class TopicBrowser {
    constructor(history, onStatsUpdate) {
      this.history = history;
      this.onStatsUpdate = onStatsUpdate;
      this.scrollController = new ScrollController();
      this.isRunning = false;
      this.viewedPosts = new Set();
      this.lastLikeTime = 0;
      // 进入本帖时的已读楼层号，「只计未读」时以它为计数起点
      this.floorBaseline = 0;
      this.unreadFloorsRead = 0;
      this.floorLimitReached = false;
    }

    async start() {
      if (this.isRunning) return;
      this.isRunning = true;

      const topicId = getCurrentTopicId();
      if (!topicId) {
        log('无法获取话题ID');
        this.stop();
        return;
      }

      log(`开始浏览话题 ${topicId}...`);
      this.history.markTopicViewed(topicId);
      this.onStatsUpdate?.();

      // 进入时先取已读位置快照：它既是「只计未读」的计数起点，也用来判断该续读还是从头读
      this.floorBaseline = getLastReadPostNumber(topicId);
      this.unreadFloorsRead = 0;
      this.floorLimitReached = false;

      if (this.floorBaseline > 0) {
        // 读过一部分的帖子：点时间线上的「返回」回到上次位置续读，不再从第一楼重刷
        await this.resumeFromLastRead();
      } else {
        await this.goToFirstPost(topicId);
        await this.scrollController.scrollToTop();
      }
      this.scrollController.reset();
      await this.browseAllReplies();

      if (this.isRunning) {
        await this.returnToList();
      }
    }

    stop() {
      this.isRunning = false;
      log('停止浏览');
    }

    async goToFirstPost(topicId) {
      const currentPath = window.location.pathname;
      const firstPostPath = `/t/topic/${topicId}/1`;

      if (currentPath === firstPostPath || currentPath === `/t/topic/${topicId}`) {
        return;
      }

      log('跳转到帖子第一楼...');
      const jumpToFirstBtn = document.querySelector('a[href*="/1"][title*="第一"], a[href*="/1"][title*="first" i], a.jump-to-first');
      if (jumpToFirstBtn) {
        jumpToFirstBtn.click();
        await randomDelay(1500, 2000);
        return;
      }

      window.location.href = firstPostPath;
      await randomDelay(2000, 2500);
    }

    // 时间线上出现「返回」就点它，跳回上次读到的楼层继续。
    // 等不到按钮（进度条尚未渲染，或当前位置本就在上次阅读处）就留在原地读
    // —— 此时 Discourse 进入话题时已自动定位到上次位置，强行跳第一楼只会重刷已读楼层
    async resumeFromLastRead() {
      const btn = await waitForBackButton(CONFIG.backButtonWaitTime);
      if (!btn) {
        log(`未出现「返回」按钮，从当前位置继续 (上次读到第 ${this.floorBaseline} 楼)`);
        return false;
      }

      log(`点击时间线「返回」，回到第 ${this.floorBaseline} 楼继续阅读`);
      btn.click();
      await randomDelay(CONFIG.loadWaitTime, CONFIG.loadWaitTime * 1.3);
      return true;
    }

    async browseAllReplies() {
      log('开始滚动浏览所有回复...');

      while (this.isRunning) {
        try {
          await this.processVisiblePosts();
          this.onStatsUpdate?.();

          if (this.floorLimitReached) break;

          if (this.scrollController.isAtBottom()) {
            log('到达页面底部，等待加载新内容...');
            await randomDelay(CONFIG.loadWaitTime, CONFIG.loadWaitTime * 1.2);

            if (!this.scrollController.hasNewContent()) {
              if (this.scrollController.isContentFullyLoaded()) {
                log('所有回复已浏览完成');
                break;
              }
            }
          }

          await this.scrollController.scrollDown();
          await randomDelay(CONFIG.scrollInterval, CONFIG.scrollInterval * 1.3);
        } catch (error) {
          log('浏览回复出错:', error.message);
          await randomDelay(2000, 3000);
        }
      }
    }

    async processVisiblePosts() {
      const posts = document.querySelectorAll('article[id^="post_"]');
      const viewportHeight = window.innerHeight;
      let newPostFound = false;

      for (const post of posts) {
        if (!this.isRunning) break;

        const postId = post.id.replace('post_', '');
        // 已处理过的楼层直接跳过，避免对全部楼层反复调用 getBoundingClientRect 触发强制回流
        if (this.viewedPosts.has(postId)) continue;

        const rect = post.getBoundingClientRect();
        if (rect.top < viewportHeight * 0.9 && rect.bottom > viewportHeight * 0.1) {
          // article 的 id 编号就是话题内楼层序号（post_12 即第 12 楼），到限额就收工换下一帖
          const floor = Number(postId);
          if (this.isOverFloorLimit(floor)) {
            this.floorLimitReached = true;
            log(`已达楼层限制，本帖浏览到第 ${floor - 1} 楼为止`);
            break;
          }

          this.viewedPosts.add(postId);
          newPostFound = true;
          if (floor > this.floorBaseline) this.unreadFloorsRead++;
          this.history.addReplyViewed();
          this.onStatsUpdate?.();

          if (CONFIG.minReadTime > 0) {
            await randomDelay(CONFIG.minReadTime, CONFIG.maxReadTime);
          }

          if (this.shouldLike()) {
            await this.tryLikePost(post, postId);
          }
        }
      }
      return newPostFound;
    }

    // 楼层限额判定：默认按绝对楼层号卡（只看前 N 楼）；
    // 开启「只计未读」后改按实际浏览到的未读楼层个数卡，已读楼层滚过不计数
    isOverFloorLimit(floor) {
      if (floorLimit <= 0) return false;
      if (floorLimitUnreadOnly) return this.unreadFloorsRead >= floorLimit;
      return Number.isFinite(floor) && floor > floorLimit;
    }

    shouldLike() {
      if (!enableLike) return false;
      if (this.history.sessionLiked >= CONFIG.maxLikesPerSession) return false;
      const now = Date.now();
      if (now - this.lastLikeTime < CONFIG.minLikeInterval) return false;
      return Math.random() < CONFIG.likeChance;
    }

    async tryLikePost(postElement, postId) {
      // 去重键必须用全局唯一的 data-post-id：post.id 里的编号是话题内楼层序号，
      // 跨话题会碰撞（话题 A 的 3 楼与话题 B 的 3 楼同号），用它会误判为已点赞而漏赞
      const actualPostId = postElement.dataset.postId;
      if (!actualPostId) return false;

      if (this.history.isPostLiked(actualPostId)) return false;

      // 已反应检测（关键防线）：discourse-reactions 插件把已反应状态 (has-reacted /
      // has-used-main-reaction) 加在外层 .discourse-reactions-actions 容器上、而非按钮本身。
      // 只要该帖已有任意反应就跳过——否则对已点赞的帖子再 toggle 会取消掉赞，或覆盖用户已选的其它表情
      const reactionActions = postElement.querySelector('.discourse-reactions-actions');
      if (reactionActions && /reacted/i.test(reactionActions.className)) {
        return false;
      }

      // 兜底：非 reactions 插件的标准 Discourse 点赞按钮，已赞时按钮带 has-like 等 class
      const likeBtn = postElement.querySelector(
        'button[title="点赞此帖子"], button[title="Like this post"], button.btn-toggle-reaction-like'
      );
      if (likeBtn && (likeBtn.classList.contains('has-like') ||
          likeBtn.classList.contains('my-likes') ||
          likeBtn.classList.contains('liked'))) {
        return false;
      }

      try {
        await randomDelay(200, 500);
        const result = await this.sendLikeRequest(actualPostId);

        if (result.success) {
          this.history.markPostLiked(actualPostId);
          this.lastLikeTime = Date.now();
          this.onStatsUpdate?.();
          log(`点赞帖子 #${postId} (id=${actualPostId})`);
          return true;
        } else if (result.rateLimited) {
          handleLikeLimit();
          return false;
        }
        return false;
      } catch (e) {
        return false;
      }
    }

    async sendLikeRequest(postId) {
      try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        if (!csrfToken) return { success: false };

        const response = await fetch(`/discourse-reactions/posts/${postId}/custom-reactions/heart/toggle.json`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          }
        });

        if (response.ok) return { success: true };

        const data = await response.json().catch(() => ({}));
        if (response.status === 429 || data.error_type === 'rate_limit') {
          return { success: false, rateLimited: true };
        }
        return { success: false };
      } catch (e) {
        return { success: false };
      }
    }

    async returnToList() {
      log('准备返回话题列表...');
      await randomDelay(CONFIG.returnToListDelay, CONFIG.returnToListDelay * 1.5);
      const returnUrl = LIST_OPTIONS[currentList]?.path || '/latest';
      window.location.href = returnUrl;
    }
  }

  // ==================== 话题列表浏览器 ====================

  class TopicListBrowser {
    constructor(history, onStatsUpdate) {
      this.history = history;
      this.onStatsUpdate = onStatsUpdate;
      this.scrollController = new ScrollController();
      this.isRunning = false;
      this.scannedTopics = new Set();
    }

    async start() {
      if (this.isRunning) return;
      this.isRunning = true;

      log('开始在列表中查找未浏览的话题...');
      this.scrollController.reset();

      let found = await this.findAndEnterUnviewedTopic();

      while (this.isRunning && !found) {
        try {
          this.onStatsUpdate?.();

          if (this.scrollController.isAtBottom()) {
            await randomDelay(CONFIG.loadWaitTime, CONFIG.loadWaitTime * 1.2);
            if (!this.scrollController.hasNewContent()) {
              if (this.scrollController.isContentFullyLoaded()) {
                await this.switchToAnotherList();
                return;
              }
            }
          }

          await this.scrollController.scrollDown();
          await randomDelay(CONFIG.scrollInterval, CONFIG.scrollInterval * 1.2);
          found = await this.findAndEnterUnviewedTopic();
        } catch (error) {
          await randomDelay(2000, 3000);
        }
      }
    }

    stop() {
      this.isRunning = false;
      log('停止列表浏览');
    }

    async findAndEnterUnviewedTopic() {
      const topicRows = document.querySelectorAll('.topic-list-item, tr[data-topic-id], .topic-list tr');

      for (const row of topicRows) {
        if (!this.isRunning) return false;

        const titleLink = row.querySelector('.title a[href*="/t/topic/"], .link-top-line a[href*="/t/topic/"], a.title[href*="/t/topic/"]');
        if (!titleLink) continue;

        const topicId = getTopicIdFromUrl(titleLink.href);
        if (!topicId) continue;

        if (this.scannedTopics.has(topicId)) continue;
        this.scannedTopics.add(topicId);

        if (this.history.isTopicViewed(topicId)) {
          this.markAsViewed(row);
          continue;
        }

        if (!this.history.canContinue()) {
          log('达到会话限制，停止');
          this.stop();
          return false;
        }

        titleLink.scrollIntoView({ behavior: 'auto', block: 'center' });
        await randomDelay(300, 600);

        log(`进入话题: ${topicId}`);
        // 直接改 location 强制当前页跳转（不点击链接，因此无需理会其 target 属性）
        window.location.href = titleLink.href;
        return true;
      }

      return false;
    }

    markAsViewed(row) {
      if (!row.classList.contains('auto-viewed')) {
        row.classList.add('auto-viewed');
        row.style.opacity = '0.6';
        const badge = document.createElement('span');
        badge.textContent = '✓';
        badge.style.cssText = 'color: #4CAF50; margin-left: 5px; font-weight: bold;';
        badge.className = 'viewed-badge';
        const title = row.querySelector('.title, .link-top-line');
        if (title && !title.querySelector('.viewed-badge')) {
          title.appendChild(badge);
        }
      }
    }

    async switchToAnotherList() {
      const targetList = LIST_OPTIONS[currentList]?.path || '/latest';
      await randomDelay(1000, 2000);
      window.location.href = targetList;
    }
  }

  // ==================== 主控制器 ====================

  class LinuxDoAutomation {
    constructor() {
      this.history = new BrowsingHistory();
      this.topicBrowser = null;
      this.listBrowser = null;
      this.isEnabled = false;
      this.panel = null;
      this.lastActivityTime = Date.now();
      this.stuckCheckInterval = null;
      this.stuckTimeout = 30000;
      this.lastUrl = window.location.href;
      this.urlCheckInterval = null;
    }

    // 附带防多开心跳记录
    heartbeat() {
      this.lastActivityTime = Date.now();
      if (this.isEnabled) {
        Storage.set('linuxdo_active_tab_id', TAB_ID);
        Storage.set('linuxdo_active_tab_time', this.lastActivityTime);
      }
    }

    checkStuck() {
      if (!this.isEnabled) return;
      const now = Date.now();
      const elapsed = now - this.lastActivityTime;

      if (elapsed > this.stuckTimeout) {
        log(`检测到卡住 (${Math.round(elapsed/1000)}秒无活动)，自动重启...`);
        this.restartBrowsing();
      }
    }

    // 根据页面类型创建对应浏览器并启动；非目标页则跳回列表
    async runBrowserFor(pageType) {
      const onUpdate = () => {
        this.updateStats();
        this.heartbeat();
      };
      if (pageType === 'topic') {
        this.topicBrowser = new TopicBrowser(this.history, onUpdate);
        await this.topicBrowser.start();
      } else if (pageType === 'list') {
        this.listBrowser = new TopicListBrowser(this.history, onUpdate);
        await this.listBrowser.start();
      } else {
        window.location.href = LIST_OPTIONS[currentList]?.path || '/latest';
      }
    }

    async restartBrowsing() {
      this.topicBrowser?.stop();
      this.listBrowser?.stop();
      this.heartbeat();

      try {
        await this.runBrowserFor(getPageType());
      } catch (error) {
        await randomDelay(3000, 5000);
        window.location.href = LIST_OPTIONS[currentList]?.path || '/latest';
      }
    }

    startStuckDetection() {
      if (this.stuckCheckInterval) clearInterval(this.stuckCheckInterval);
      this.heartbeat();
      this.stuckCheckInterval = setInterval(() => this.checkStuck(), 10000);
    }

    stopStuckDetection() {
      if (this.stuckCheckInterval) {
        clearInterval(this.stuckCheckInterval);
        this.stuckCheckInterval = null;
      }
    }

    startUrlWatcher() {
      if (this.urlCheckInterval) clearInterval(this.urlCheckInterval);
      this.lastUrl = window.location.href;
      this.urlCheckInterval = setInterval(() => this.checkUrlChange(), 500);
    }

    stopUrlWatcher() {
      if (this.urlCheckInterval) {
        clearInterval(this.urlCheckInterval);
        this.urlCheckInterval = null;
      }
    }

    checkUrlChange() {
      const currentUrl = window.location.href;
      if (currentUrl !== this.lastUrl) {
        const oldPageType = this.getPageTypeFromUrl(this.lastUrl);
        const newPageType = getPageType();
        this.lastUrl = currentUrl;

        const pageTypeEl = document.getElementById('page-type');
        if (pageTypeEl) pageTypeEl.textContent = newPageType;

        if (this.isEnabled && oldPageType !== newPageType) {
          this.handlePageTypeChange(newPageType);
        }
      }
    }

    getPageTypeFromUrl(url) {
      try {
        return getPageTypeFromPath(new URL(url).pathname);
      } catch (e) {
        return 'other';
      }
    }

    async handlePageTypeChange(newPageType) {
      this.topicBrowser?.stop();
      this.listBrowser?.stop();
      await randomDelay(1000, 1500);
      this.heartbeat();

      try {
        await this.runBrowserFor(newPageType);
      } catch (error) {
        await randomDelay(2000, 3000);
        this.restartBrowsing();
      }
    }

    init() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setup());
      } else {
        this.setup();
      }
    }

    setup(retryCount = 0) {
      const loginState = getLoginState();

      // 无法判定登录状态（Ember 未渲染完成或 Cloudflare 挑战页）：轮询等待，最多 10 秒
      // 挑战页通过后会整页跳转、脚本重新注入，因此超时放弃是安全的
      if (loginState === null) {
        if (retryCount < 20) {
          setTimeout(() => this.setup(retryCount + 1), 500);
        } else {
          log('无法检测登录状态，跳过初始化');
        }
        return;
      }

      if (loginState === false) {
        log('请先登录 Linux.do');
        return;
      }

      this.createControlPanel();
      readingTracker.onUpdate = () => this.updateStats();
      this.topicBrowser = new TopicBrowser(this.history, () => this.updateStats());
      this.listBrowser = new TopicListBrowser(this.history, () => this.updateStats());

      const autoResume = Storage.get('auto_running', false);

      if (autoResume) {
        // --- 核心修复：防止多开无限自启动 ---
        const lastActiveTime = Storage.get('linuxdo_active_tab_time', 0);
        const activeTabId = Storage.get('linuxdo_active_tab_id', null);

        // 如果在15秒内有其他标签页活动，且不是当前标签页，放弃自启
        if (Date.now() - lastActiveTime < 15000 && activeTabId !== TAB_ID) {
            log('🚫 检测到其他标签页正在运行自动浏览，当前页面取消自动恢复');
            this.updateStats();
            document.getElementById('auto-status').textContent = '多开限制，未自启';
            return;
        }

        log('检测到自动运行状态，3秒后恢复运行...');
        setTimeout(() => {
          this.start();
        }, 3000);
      }
      this.updateStats();
    }

    createControlPanel() {
      const style = document.createElement('style');
      style.textContent = `
        #linuxdo-auto-panel {
          position: fixed; right: 20px; bottom: 20px; z-index: 99999;
          width: 264px; box-sizing: border-box;
          background: linear-gradient(160deg, #6d5bf0 0%, #7c4ddb 55%, #8b5cf6 100%);
          border: 1px solid rgba(255,255,255,0.14); border-radius: 16px;
          box-shadow: 0 12px 32px rgba(60,25,120,0.32), 0 2px 8px rgba(0,0,0,0.14);
          color: #fff; font-size: 13px; line-height: 1.4;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
          user-select: none; -webkit-user-select: none;
          /* 尺寸是瞬变的，圆角必须跟着瞬变：否则 50% 圆角会短暂作用在展开后的矩形上，闪出一个大椭圆 */
          transition: box-shadow .2s ease;
        }
        #linuxdo-auto-panel.dragging { box-shadow: 0 18px 44px rgba(60,25,120,0.45); }
        /* Discourse 全局样式会命中 svg 与盒模型，这里用 id 特异性顶回去 */
        #linuxdo-auto-panel, #linuxdo-auto-panel * { box-sizing: border-box; }
        #linuxdo-auto-panel svg { display: block; fill: none; stroke: currentColor; }

        /* 收起态：只留一个悬浮球 */
        #linuxdo-auto-panel.minimized { width: 56px; height: 56px; border-radius: 50%; }
        #linuxdo-auto-panel.minimized .panel-content,
        #linuxdo-auto-panel.minimized .panel-title,
        #linuxdo-auto-panel.minimized .btn-minimize { display: none; }
        #linuxdo-auto-panel.minimized .panel-header { width: 100%; height: 100%; padding: 0; justify-content: center; cursor: pointer; }
        #linuxdo-auto-panel.minimized .fab-icon { display: flex; }
        #linuxdo-auto-panel.minimized:hover { box-shadow: 0 12px 30px rgba(60,25,120,0.5); }
        /* 悬浮球上的运行指示：绿点 + 呼吸光环 */
        #linuxdo-auto-panel.minimized.running::before {
          content: ''; position: absolute; top: 3px; right: 3px; width: 10px; height: 10px;
          border-radius: 50%; background: #22c55e; border: 2px solid rgba(255,255,255,0.92);
          pointer-events: none;
        }
        #linuxdo-auto-panel.minimized.running::after {
          content: ''; position: absolute; inset: -3px; border-radius: 50%;
          border: 2px solid rgba(74,222,128,0.7); animation: fab-pulse 1.8s ease-out infinite;
          pointer-events: none;
        }
        @keyframes fab-pulse {
          0% { transform: scale(1); opacity: .8; }
          100% { transform: scale(1.35); opacity: 0; }
        }

        /* 标题栏同时是拖动手柄 */
        #linuxdo-auto-panel .panel-header {
          display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px 14px;
          cursor: grab; touch-action: none;
        }
        #linuxdo-auto-panel.dragging .panel-header { cursor: grabbing; }
        #linuxdo-auto-panel .panel-title { flex: 1; font-size: 14px; font-weight: 600; letter-spacing: .2px; }
        #linuxdo-auto-panel .fab-icon { display: none; align-items: center; justify-content: center; }
        #linuxdo-auto-panel .btn-minimize {
          display: flex; align-items: center; justify-content: center; flex: none;
          width: 22px; height: 22px; padding: 0; border: 0; border-radius: 7px;
          background: rgba(255,255,255,0.16); color: #fff; cursor: pointer; transition: background .15s;
        }
        #linuxdo-auto-panel .btn-minimize:hover { background: rgba(255,255,255,0.3); }

        #linuxdo-auto-panel .panel-content { padding: 0 14px 14px; animation: panel-in .18s ease; }
        #linuxdo-auto-panel.closing .panel-content { animation: panel-out .16s ease forwards; }
        @keyframes panel-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        @keyframes panel-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-4px); } }

        /* 分段选择器 */
        #linuxdo-auto-panel .row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        #linuxdo-auto-panel .row.hidden { display: none; }
        #linuxdo-auto-panel .row-label { flex: none; width: 28px; font-size: 12px; color: rgba(255,255,255,0.72); }
        #linuxdo-auto-panel .seg { display: flex; flex: 1; gap: 2px; padding: 2px; background: rgba(0,0,0,0.16); border-radius: 9px; }
        #linuxdo-auto-panel .speed-btn {
          flex: 1 1 0; padding: 5px 0; border: 0; border-radius: 7px; background: transparent;
          color: rgba(255,255,255,0.78); font-size: 11px; font-family: inherit; cursor: pointer;
          transition: background .15s, color .15s;
        }
        #linuxdo-auto-panel .speed-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }
        #linuxdo-auto-panel .speed-btn.active { background: #fff; color: #5b3bc4; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.18); }

        /* 楼层限制：数字输入框 + 勾选框 */
        #linuxdo-auto-panel .floor-input {
          flex: 1; min-width: 0; height: 27px; padding: 0 8px;
          border: 1px solid rgba(255,255,255,0.24); border-radius: 8px;
          background: rgba(0,0,0,0.16); color: #fff;
          font-size: 12px; font-family: inherit; text-align: center;
          /* 面板整体禁选，输入框要单独放开才能编辑 */
          user-select: text; -webkit-user-select: text;
        }
        #linuxdo-auto-panel .floor-input::placeholder { color: rgba(255,255,255,0.5); }
        #linuxdo-auto-panel .floor-input:focus {
          outline: none; border-color: rgba(255,255,255,0.62); background: rgba(0,0,0,0.24);
        }
        /* 数字框自带的步进箭头在窄面板里挤版，隐掉 */
        #linuxdo-auto-panel .floor-input::-webkit-inner-spin-button,
        #linuxdo-auto-panel .floor-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        #linuxdo-auto-panel .floor-check {
          display: flex; align-items: center; gap: 6px; flex: 1;
          font-size: 11px; color: rgba(255,255,255,0.76); cursor: pointer;
        }
        #linuxdo-auto-panel .floor-check input {
          width: 13px; height: 13px; margin: 0; flex: none;
          accent-color: #fff; cursor: pointer;
        }
        /* 控件下方的说明文字，左边距对齐控件（标签 28px + 间距 10px） */
        #linuxdo-auto-panel .row-hint {
          margin: -4px 0 8px 38px; font-size: 10px; line-height: 1.5;
          color: rgba(255,255,255,0.58);
        }

        /* 动作按钮 */
        #linuxdo-auto-panel .action-btn {
          width: 100%; margin-top: 8px; padding: 9px; border: 0; border-radius: 10px;
          font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; transition: filter .15s, background .15s;
        }
        #linuxdo-auto-panel .action-btn:hover { filter: brightness(1.08); }
        #linuxdo-auto-panel .btn-start { background: #22c55e; color: #fff; box-shadow: 0 2px 10px rgba(34,197,94,0.32); }
        #linuxdo-auto-panel .btn-stop { background: #ef4444; color: #fff; box-shadow: 0 2px 10px rgba(239,68,68,0.32); }
        #linuxdo-auto-panel .btn-clear {
          padding: 7px; background: transparent; border: 1px solid rgba(255,255,255,0.26);
          color: rgba(255,255,255,0.82); font-size: 12px; font-weight: 500;
        }
        #linuxdo-auto-panel .btn-clear:hover { background: rgba(255,255,255,0.12); }

        /* 统计区 */
        #linuxdo-auto-panel .stats { margin-top: 10px; padding: 9px 12px; background: rgba(0,0,0,0.14); border-radius: 10px; }
        #linuxdo-auto-panel .stats-row { display: flex; justify-content: space-between; align-items: center; margin: 5px 0; font-size: 12px; }
        #linuxdo-auto-panel .stats-label { color: rgba(255,255,255,0.68); }
        #linuxdo-auto-panel .stats-value { font-weight: 600; font-variant-numeric: tabular-nums; }
        #linuxdo-auto-panel .status-indicator { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
        #linuxdo-auto-panel .status-indicator.running { background: #22c55e; animation: pulse 1.5s infinite; }
        #linuxdo-auto-panel .status-indicator.stopped { background: #f87171; }

        /* Credit 积分区 */
        #linuxdo-auto-panel .credit-section { margin-top: 8px; padding: 9px 12px; background: rgba(0,0,0,0.14); border-radius: 10px; }
        #linuxdo-auto-panel .credit-header {
          display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;
          font-size: 12px; color: rgba(255,255,255,0.68);
        }
        #linuxdo-auto-panel .credit-refresh {
          border: 0; padding: 2px 8px; border-radius: 6px; cursor: pointer;
          background: rgba(255,255,255,0.16); color: #fff; font-size: 10px; font-family: inherit;
          transition: background .15s;
        }
        #linuxdo-auto-panel .credit-refresh:hover { background: rgba(255,255,255,0.3); }
        #linuxdo-auto-panel .credit-refresh:disabled { opacity: .5; cursor: default; }
        #linuxdo-auto-panel .credit-main {
          display: flex; justify-content: space-between; align-items: baseline; margin: 4px 0;
          font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums;
        }
        #linuxdo-auto-panel .credit-sub { display: flex; justify-content: space-between; margin: 3px 0; font-size: 11px; }
        #linuxdo-auto-panel .credit-sub .stats-label { color: rgba(255,255,255,0.6); }
        #linuxdo-auto-panel .credit-sub .stats-value { font-weight: 500; }
        #linuxdo-auto-panel .credit-link {
          display: inline-block; margin-top: 5px; font-size: 10px;
          color: rgba(255,255,255,0.62); text-decoration: none;
        }
        #linuxdo-auto-panel .credit-link:hover { color: #fff; text-decoration: underline; }
        #linuxdo-auto-panel .credit-status { font-size: 10px; color: rgba(255,255,255,0.55); }

        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .auto-viewed { opacity: 0.6; }
      `;
      document.head.appendChild(style);

      const panel = document.createElement('div');
      panel.id = 'linuxdo-auto-panel';
      panel.innerHTML = `
        <div class="panel-header">
          <span class="fab-icon">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 7v14"/>
              <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>
            </svg>
          </span>
          <span class="panel-title">Linux.do 自动助手</span>
          <button class="btn-minimize" id="btn-minimize" title="收起">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg>
          </button>
        </div>
        <div class="panel-content">
          <div class="row"><span class="row-label">速度</span><div class="seg">
            <button class="speed-btn ${currentSpeed==='slow'?'active':''}" data-speed="slow">慢</button>
            <button class="speed-btn ${currentSpeed==='normal'?'active':''}" data-speed="normal">正常</button>
            <button class="speed-btn ${currentSpeed==='fast'?'active':''}" data-speed="fast">快</button>
            <button class="speed-btn ${currentSpeed==='turbo'?'active':''}" data-speed="turbo">极速</button>
          </div></div>
          <div class="row"><span class="row-label">列表</span><div class="seg">
            <button class="speed-btn list-btn ${currentList==='latest'?'active':''}" data-list="latest">最新</button>
            <button class="speed-btn list-btn ${currentList==='new'?'active':''}" data-list="new">新帖</button>
            <button class="speed-btn list-btn ${currentList==='unread'?'active':''}" data-list="unread">未读</button>
          </div></div>
          <div class="row"><span class="row-label">点赞</span><div class="seg">
            <button class="speed-btn like-btn ${enableLike?'active':''}" data-like="true">开启</button>
            <button class="speed-btn like-btn ${!enableLike?'active':''}" data-like="false">关闭</button>
          </div></div>
          <div class="row${enableLike?'':' hidden'}" id="like-chance-row"><span class="row-label">概率</span><div class="seg">
            <button class="speed-btn chance-btn ${currentLikeChance==='low'?'active':''}" data-chance="low" title="约 5% 概率点赞">低</button>
            <button class="speed-btn chance-btn ${currentLikeChance==='medium'?'active':''}" data-chance="medium" title="约 15% 概率点赞">中</button>
            <button class="speed-btn chance-btn ${currentLikeChance==='high'?'active':''}" data-chance="high" title="约 25% 概率点赞">高</button>
            <button class="speed-btn chance-btn ${currentLikeChance==='veryHigh'?'active':''}" data-chance="veryHigh" title="约 40% 概率点赞">极高</button>
          </div></div>
          <div class="row"><span class="row-label">楼层</span>
            <input type="number" class="floor-input" id="floor-limit-input" min="0" step="1"
              placeholder="不限" title="每帖只浏览前 N 楼后换下一帖，留空或 0 表示不限">
          </div>
          <div class="row-hint">填 N 则每帖读到第 N 楼就换下一帖，留空或填 0 表示整帖读完</div>
          <div class="row"><span class="row-label"></span>
            <label class="floor-check" title="开启后已读楼层滚过不计数，只数上次阅读位置之后的新楼层">
              <input type="checkbox" id="floor-unread-only">只计未读楼层
            </label>
          </div>
          <div class="row-hint">默认按楼层号数到第 N 楼；勾选后从上次读到的位置往后数 N 楼，已读楼层不计入</div>
          <button class="action-btn btn-start" id="btn-auto-start">开始自动浏览</button>
          <button class="action-btn btn-stop" id="btn-auto-stop" style="display:none;">停止运行</button>
          <button class="action-btn btn-clear" id="btn-clear-history">清除浏览记录</button>
          <div class="stats">
            <div class="stats-row"><span class="stats-label">状态</span><span class="stats-value"><span class="status-indicator stopped" id="status-dot"></span><span id="auto-status">未启动</span></span></div>
            <div class="stats-row"><span class="stats-label">页面类型</span><span class="stats-value" id="page-type">-</span></div>
            <div class="stats-row"><span class="stats-label">本次帖子/回复</span><span class="stats-value"><span id="session-viewed">0</span> / <span id="session-replies">0</span></span></div>
            <div class="stats-row"><span class="stats-label">本次点赞</span><span class="stats-value" id="session-liked">0</span></div>
            <div class="stats-row"><span class="stats-label">本次总阅读量</span><span class="stats-value" id="session-read-count">0</span></div>
          </div>
          <div class="credit-section" id="credit-section">
            <div class="credit-header">
              <span>💰 Credit (LDC)</span>
              <button class="credit-refresh" id="btn-credit-refresh" title="立即刷新（频繁刷新会被 credit 站限流）">刷新</button>
            </div>
            <div id="credit-body"><div class="credit-status">加载中...</div></div>
            <a class="credit-link" href="https://credit.linux.do/home" target="_blank" rel="noopener">查看明细 →</a>
          </div>
        </div>
      `;
      document.body.appendChild(panel);
      this.panel = panel;

      // 默认收起成悬浮球，只在用户展开过后才记住展开态
      if (Storage.get('panel_minimized', true)) {
        panel.classList.add('minimized');
      }
      this.restorePosition();
      this.initDrag();

      document.getElementById('btn-auto-start').addEventListener('click', () => this.start(true));
      document.getElementById('btn-auto-stop').addEventListener('click', () => this.stop());
      document.getElementById('btn-minimize').addEventListener('click', () => this.toggleMinimize());
      document.getElementById('btn-clear-history').addEventListener('click', () => this.clearHistory());

      document.querySelectorAll('.speed-btn[data-speed]').forEach(btn => btn.addEventListener('click', (e) => {
        setSpeed(e.target.dataset.speed);
        document.querySelectorAll('.speed-btn[data-speed]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      }));
      document.querySelectorAll('.list-btn[data-list]').forEach(btn => btn.addEventListener('click', (e) => {
        setList(e.target.dataset.list);
        document.querySelectorAll('.list-btn[data-list]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      }));
      document.querySelectorAll('.like-btn[data-like]').forEach(btn => btn.addEventListener('click', (e) => {
        setEnableLike(e.target.dataset.like === 'true');
        document.querySelectorAll('.like-btn[data-like]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      }));
      document.querySelectorAll('.chance-btn[data-chance]').forEach(btn => btn.addEventListener('click', (e) => {
        setLikeChance(e.target.dataset.chance);
        document.querySelectorAll('.chance-btn[data-chance]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      }));

      const floorInput = document.getElementById('floor-limit-input');
      floorInput.value = floorLimit > 0 ? floorLimit : '';
      // Discourse 绑了一堆单键快捷键（j/k 翻楼等），输入框里的按键不能冒泡出去
      floorInput.addEventListener('keydown', (e) => e.stopPropagation());
      floorInput.addEventListener('change', (e) => {
        setFloorLimit(e.target.value);
        // 回写规范化后的值：负数、小数、非法输入统一显示成实际生效的值
        e.target.value = floorLimit > 0 ? floorLimit : '';
      });

      const floorCheck = document.getElementById('floor-unread-only');
      floorCheck.checked = floorLimitUnreadOnly;
      floorCheck.addEventListener('change', (e) => setFloorLimitUnreadOnly(e.target.checked));

      document.getElementById('page-type').textContent = getPageType();

      // Credit 积分区：懒初始化 + 立即展示缓存 + 按节流策略拉新
      if (!creditTracker) creditTracker = new CreditTracker();
      this.renderCredit(creditTracker.cachedData, 'cache');
      creditTracker.fetch().then(data => this.renderCredit(data, 'fetch'));
      document.getElementById('btn-credit-refresh').addEventListener('click', () => this.refreshCredit());
    }

    // 渲染 Credit 区。state: 'cache' | 'fetch' | 'refresh'，用于状态行文案
    // 安全说明：所有插入 innerHTML 的动态值均来自 CreditTracker.formatAmount（纯数字格式化输出）
    // 或下方 escapeHtml 转义后的字符串，不存在未转义的外部数据
    renderCredit(data, state = 'fetch') {
      const body = document.getElementById('credit-body');
      const refreshBtn = document.getElementById('btn-credit-refresh');
      if (!body) return;
      if (refreshBtn) refreshBtn.disabled = false;

      if (!data) {
        const now = Date.now();
        if (creditTracker?.cooldownUntil > now) {
          const mins = Math.ceil((creditTracker.cooldownUntil - now) / 60000);
          body.innerHTML = `<div class="credit-status">限流冷却中，约 ${mins} 分钟后可刷新</div>`;
        } else {
          body.innerHTML = `<div class="credit-status">未获取到（需先登录 <a href="https://credit.linux.do/home" target="_blank" rel="noopener" style="color:inherit;">credit.linux.do</a>）</div>`;
        }
        return;
      }

      const timeStr = new Date(data.fetchTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const stateText = state === 'cache' ? `缓存 ${timeStr}` : `${timeStr}`;
      body.innerHTML = `
        <div class="credit-main"><span>可用余额</span><span>${CreditTracker.formatAmount(data.available)}</span></div>
        <div class="credit-sub"><span class="stats-label">社区积分</span><span class="stats-value">${CreditTracker.formatAmount(data.community)}</span></div>
        <div class="credit-sub"><span class="stats-label">今日剩余额度</span><span class="stats-value">${CreditTracker.formatAmount(data.remainQuota)}</span></div>
        <div class="credit-sub"><span class="stats-label">累计收支</span><span class="stats-value">+${CreditTracker.formatAmount(data.totalReceive)} / -${CreditTracker.formatAmount(data.totalPayment)}</span></div>
        <div class="credit-status">更新于 ${stateText}</div>
      `;
    }

    // 手动刷新：绕过 5 分钟节流（429 冷却期内仍拒绝），按钮置灰防连点
    async refreshCredit() {
      const refreshBtn = document.getElementById('btn-credit-refresh');
      if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '刷新中...';
      }
      const data = await creditTracker.fetch(true);
      this.renderCredit(data, 'refresh');
      if (refreshBtn) refreshBtn.textContent = '刷新';
    }

    // 拖动：手柄是标题栏（收起态下它就是整个悬浮球），松手后记住位置
    // 位移不超过阈值视为点击，收起态下即展开面板
    initDrag() {
      const panel = this.panel;
      const handle = panel.querySelector('.panel-header');
      const DRAG_THRESHOLD = 4;

      let pointerId = null;
      let startX = 0, startY = 0, originLeft = 0, originTop = 0, moved = false;

      const onMove = (e) => {
        if (e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        if (!moved) {
          moved = true;
          panel.classList.add('dragging');
        }
        this.setPosition(originLeft + dx, originTop + dy);
      };

      const onUp = (e) => {
        if (e.pointerId !== pointerId) return;
        try { handle.releasePointerCapture(pointerId); } catch (err) { /* 捕获可能已自动释放 */ }
        pointerId = null;
        panel.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);

        if (moved) {
          this.savePosition();
        } else if (panel.classList.contains('minimized')) {
          this.toggleMinimize();
        }
      };

      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || pointerId !== null) return;
        if (e.target.closest('button')) return; // 收起按钮走自己的 click

        const rect = panel.getBoundingClientRect();
        originLeft = rect.left;
        originTop = rect.top;
        startX = e.clientX;
        startY = e.clientY;
        moved = false;
        pointerId = e.pointerId;

        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 部分环境不支持指针捕获 */ }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        e.preventDefault();
      });

      window.addEventListener('resize', () => this.clampPosition());
    }

    // 改用视口左上角定位，并把面板钳制在可视范围内
    setPosition(left, top) {
      const panel = this.panel;
      const margin = 8;
      const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
      const maxTop = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);
      panel.style.left = `${Math.round(Math.min(Math.max(left, margin), maxLeft))}px`;
      panel.style.top = `${Math.round(Math.min(Math.max(top, margin), maxTop))}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    clampPosition() {
      if (!this.panel.style.left) return; // 没拖动过，保持默认右下角锚定
      const rect = this.panel.getBoundingClientRect();
      this.setPosition(rect.left, rect.top);
    }

    savePosition() {
      const rect = this.panel.getBoundingClientRect();
      Storage.set('panel_pos', {
        left: rect.left,
        top: rect.top,
        right: window.innerWidth - rect.right,
        alignRight: rect.left + rect.width / 2 > window.innerWidth / 2
      });
    }

    restorePosition() {
      const pos = Storage.get('panel_pos', null);
      if (!pos || !Number.isFinite(pos.top)) return;
      const left = pos.alignRight && Number.isFinite(pos.right)
        ? window.innerWidth - pos.right - this.panel.offsetWidth
        : pos.left;
      if (Number.isFinite(left)) this.setPosition(left, pos.top);
    }

    // 展开由 CSS 的 panel-in 负责淡入；收起要先把内容淡出再变回悬浮球，两边动画才对称
    toggleMinimize() {
      const panel = this.panel;
      if (panel.classList.contains('minimized')) {
        this.setMinimized(false);
        return;
      }
      if (panel.classList.contains('closing')) return;

      panel.classList.add('closing');
      const content = panel.querySelector('.panel-content');
      const done = () => {
        clearTimeout(timer);
        content.removeEventListener('animationend', done);
        // 先切成悬浮球把内容藏起来，再摘 closing，否则会闪一下入场动画
        this.setMinimized(true);
        panel.classList.remove('closing');
      };
      content.addEventListener('animationend', done);
      // 标签页切到后台时 animationend 不一定触发，兜底收尾
      const timer = setTimeout(done, 400);
    }

    setMinimized(minimized) {
      const panel = this.panel;
      const before = panel.getBoundingClientRect();
      // 面板在屏幕右半边时保持右边缘不动，展开才不会往视口外顶
      const keepRight = before.left + before.width / 2 > window.innerWidth / 2;

      panel.classList.toggle('minimized', minimized);
      Storage.set('panel_minimized', minimized);

      if (panel.style.left) {
        this.setPosition(keepRight ? before.right - panel.offsetWidth : before.left, before.top);
      } else if (panel.getBoundingClientRect().top < 0) {
        // 默认锚在右下角，视口太矮时展开会顶出屏幕，转为绝对定位兜底
        const rect = panel.getBoundingClientRect();
        this.setPosition(rect.left, 8);
      }
    }

    updateStats() {
      const stats = this.history.getStats();
      document.getElementById('session-viewed').textContent = stats.sessionViewed;
      document.getElementById('session-replies').textContent = stats.sessionReplies;
      document.getElementById('session-liked').textContent = stats.sessionLiked;
      document.getElementById('session-read-count').textContent = readingTracker.count;
    }

    async start(isManual = false) {
      // 如果是手动启动，检查是否有其他正在运行的进程
      if (isManual) {
        const lastActiveTime = Storage.get('linuxdo_active_tab_time', 0);
        const activeTabId = Storage.get('linuxdo_active_tab_id', null);
        if (Date.now() - lastActiveTime < 15000 && activeTabId !== TAB_ID && Storage.get('auto_running', false)) {
            if (!confirm('⚠️ 警告：检测到后台已有其他页面正在自动浏览。\\n\\n如果在多页同时运行可能会导致浏览器卡死。强制接管此页码？')) {
                return;
            }
        }

        // 手动点击「开始」时清零本次总阅读量（自动恢复运行时不清零，保证刷新/跳转后延续）
        readingTracker.reset();
      }

      this.isEnabled = true;
      Storage.set('auto_running', true);
      this.heartbeat();

      document.getElementById('btn-auto-start').style.display = 'none';
      document.getElementById('btn-auto-stop').style.display = 'block';
      document.getElementById('auto-status').textContent = '运行中';
      document.getElementById('status-dot').className = 'status-indicator running';
      this.panel.classList.add('running');

      this.startStuckDetection();
      this.startUrlWatcher();

      try {
        await this.runBrowserFor(getPageType());
      } catch (error) {
        if (this.isEnabled) {
          document.getElementById('auto-status').textContent = '出错，重试中...';
          await randomDelay(5000, 8000);
          if (this.isEnabled) this.restartBrowsing();
        }
      }
    }

    stop() {
      this.isEnabled = false;
      Storage.set('auto_running', false);
      Storage.set('linuxdo_active_tab_time', 0); // 释放占用锁

      this.stopStuckDetection();
      this.stopUrlWatcher();
      this.topicBrowser?.stop();
      this.listBrowser?.stop();

      document.getElementById('btn-auto-start').style.display = 'block';
      document.getElementById('btn-auto-stop').style.display = 'none';
      document.getElementById('auto-status').textContent = '已停止';
      document.getElementById('status-dot').className = 'status-indicator stopped';
      this.panel.classList.remove('running');
    }

    clearHistory() {
      if (confirm('确定要清除所有浏览记录吗？这将允许重新浏览所有话题。')) {
        this.history.clearHistory();
        this.updateStats();
        alert('浏览记录已清除');
      }
    }
  }

  // ==================== 启动（仅浏览器） ====================
  // Node 环境（单元测试）无 window/DOM，跳过启动逻辑，只导出纯函数供测试。
  if (typeof window !== 'undefined') {
    installTimingsHook();
    const automation = new LinuxDoAutomation();
    automation.init();

    // 页面卸载时把节流未落盘的浏览记录 flush 掉，避免翻页时丢失最后几条记录
    // flushPending 只在确有待写数据时才写，路过/未登录页面不会触发，避免空数据覆盖历史
    // 注意：这里不再释放防多开锁——脚本自身翻页也会触发 beforeunload，会导致锁在每次
    // 跳转间隙被误释放；锁改为依赖 15 秒心跳超时自然失效，手动停止时由 stop() 主动释放
    window.addEventListener('beforeunload', () => {
      automation.history.flushPending();
    });
  }

  // ==================== Node 测试导出 ====================
  // 仅在 Node（package.json 测试）环境生效；浏览器里 module 未定义，直接跳过。
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getPageTypeFromPath,
      getTopicIdFromUrl,
      trimSet,
      randomInt,
    };
  }
})();
