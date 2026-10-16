import { BaseAgent } from './vendor/ton-ai-core/agent/index.js';

var el = document.getElementById('label');
var hint = document.getElementById('hint');

function detectBridge() {
  var tg = typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
  }
  return tg;
}

function setLabel(text, animate) {
  if (!animate) {
    el.textContent = text;
    return;
  }
  el.classList.add('swap-out');
  setTimeout(function () {
    el.textContent = text;
    el.classList.remove('swap-out');
    el.classList.add('swap-in');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.classList.remove('swap-in');
      });
    });
  }, 220);
}

function fail(msg) {
  hint.textContent = msg;
}

class HelloAgent extends BaseAgent {
  constructor() {
    super({ name: 'tgcloud-mini-app' });
    this.bridge = null;
    this.unbind = null;
  }
  async onInitialize() {}
  async onStart() {}
  async onStop() {
    if (this.unbind) {
      var unbind = this.unbind;
      this.unbind = null;
      unbind();
    }
  }
  callSkill(method, params) {
    var tg = this.bridge;
    return new Promise(function (resolve, reject) {
      if (!tg) {
        reject(new Error('open me inside Telegram to switch via skill'));
        return;
      }
      if (!tg.Serverless || typeof tg.Serverless.call !== 'function') {
        reject(new Error('Mini App bridge unavailable — update Telegram'));
        return;
      }
      try {
        tg.Serverless.call(method, params, function (err, res) {
          if (err) {
            reject(err);
            return;
          }
          resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }
  switchLabel(current) {
    var self = this;
    return this.callSkill('nextLabel', { current: current }).then(function (res) {
      if (!res || typeof res.label !== 'string') {
        throw new Error('bad answer from skill, try again');
      }
      self.emit('label:changed', { label: res.label });
      return res.label;
    });
  }
}

var agent = new HelloAgent();
agent.bridge = detectBridge();

agent.on('label:changed', function (payload) {
  hint.textContent = 'tap anywhere to switch';
  setLabel(payload.label, true);
  var tg = agent.bridge;
  if (tg && tg.HapticFeedback) {
    try { tg.HapticFeedback.impactOccurred('light'); } catch (e) {}
  }
});

function cycle() {
  agent.switchLabel(el.textContent || '').then(null, function (err) {
    fail((err && err.message) || String(err) || 'switch failed, try again');
  });
}

agent.initialize().then(function () {
  return agent.start();
}).then(function () {
  document.body.addEventListener('click', cycle);
  agent.unbind = function () {
    document.body.removeEventListener('click', cycle);
  };
}, function (err) {
  fail((err && err.message) || String(err) || 'switch failed, try again');
});
