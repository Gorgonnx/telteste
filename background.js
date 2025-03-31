const TIPOS_PAUSA = {
  "ALMOCO": 3600,
  "CAFE": 900,
  "BANHEIRO": 600,
  "AGUA": 600,
  "SOLICITACAO_DO(A)_GERENTE": 5,
  "ATENDIMENTO_PRESENCIAL": 5,
  "ATIVACAO_BACKOFFICE": 600,
  "REUNIAO_TREINAMENTO": 3600,
  "SUP_N1-ATENDIMENTO_ATIVO": 3600
};

const ALARM_NAME_KEEP_ALIVE = "keepAliveAlarm";

let pausasAtivas = new Map();
let abaMonitoradaId = null;
let popupAberto = false;

chrome.runtime.onInstalled.addListener(() => {
  console.log("[INFO] Extensão Monitor de Pausa instalada.");
  inicializarEstado();
  chrome.alarms.create(ALARM_NAME_KEEP_ALIVE, { periodInMinutes: 0.25 });
});

chrome.windows.onRemoved.addListener(handleWindowRemoved);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME_KEEP_ALIVE) {
    console.log("[KEEP-ALIVE] Alarme secundário disparado, resetando temporizador:", Date.now());
    verificarPausasPendentes();
  } else {
    tratarAlarmePausa(alarm);
  }
});

chrome.runtime.onMessage.addListener(handleMessage);

function inicializarEstado() {
  chrome.storage.local.get(['pausasAtivas', 'alarms'], (result) => {
    if (result.pausasAtivas) {
      pausasAtivas = new Map(Object.entries(result.pausasAtivas));
      console.log("[INIT] Estado de pausasAtivas recuperado:", pausasAtivas);
    }
    if (result.alarms) {
      result.alarms.forEach(alarm => {
        if (pausasAtivas.has(alarm.name.toUpperCase())) {
          const info = pausasAtivas.get(alarm.name.toUpperCase());
          const tempoRestante = Math.max(0, (alarm.scheduledTime - Date.now()) / 1000);
          if (tempoRestante > 0) {
            chrome.alarms.create(alarm.name, { when: Date.now() + (tempoRestante * 1000) });
            console.log("[RECOVER] Alarme recriado para", alarm.name, "com", tempoRestante, "segundos restantes");
          }
        }
      });
    }
    verificarPausasPendentes();
  });
}

function iniciarTemporizador(tipoPausa) {
  clearExistingAlarms();
  pausasAtivas.clear();
  popupAberto = false;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      abaMonitoradaId = tabs[0].id;
      console.log(`[DEBUG] Aba monitorada atualizada: ID ${abaMonitoradaId} para ${tipoPausa}`);
    } else {
      console.error("[ERROR] Nenhuma aba ativa encontrada para monitoramento");
      return;
    }

    const tempoLimiteSegundos = TIPOS_PAUSA[tipoPausa.toUpperCase()] || 300;
    const tempoInicio = Date.now();
    const tempoFim = tempoInicio + (tempoLimiteSegundos * 1000);
    console.log(`[START] Iniciando alarme: ${tipoPausa}, Limite: ${tempoLimiteSegundos}s, Início: ${tempoInicio}, Fim: ${tempoFim}`);

    chrome.alarms.create(tipoPausa.toUpperCase(), { when: tempoFim });
    pausasAtivas.set(tipoPausa.toUpperCase(), { tempoInicio: tempoInicio, tempoLimite: tempoLimiteSegundos });
    salvarEstado();
    console.log(`[SUCCESS] Novo alarme iniciado para ${tipoPausa} com limite de ${tempoLimiteSegundos / 60} minutos`);
  });
}

function pararTemporizador() {
  clearExistingAlarms();
  pausasAtivas.clear();
  salvarEstado();
  popupAberto = false;
}

function verificarPausasPendentes() {
  pausasAtivas.forEach((info, tipoPausa) => {
    const tempoDecorrido = Math.floor((Date.now() - info.tempoInicio) / 1000);
    console.log(`[CHECK] Verificando ${tipoPausa}: ${tempoDecorrido}s / ${info.tempoLimite}s`);
    if (tempoDecorrido >= info.tempoLimite) {
      console.log(`[CHECK] Pausa ${tipoPausa} excedida ao retomar, disparando popup`);
      pausasAtivas.delete(tipoPausa);
      chrome.alarms.clear(tipoPausa);
      abrirPopupAlerta(tipoPausa, info.tempoLimite);
      registrarPausaExcedida(`Tempo de pausa (${tipoPausa}) excedido!`);
      salvarEstado();
    }
  });
}

function tratarAlarmePausa(alarm) {
  const tipoPausa = alarm.name.toUpperCase();
  if (pausasAtivas.has(tipoPausa)) {
    const info = pausasAtivas.get(tipoPausa);
    const tempoDecorrido = Math.floor((Date.now() - info.tempoInicio) / 1000);
    console.log(`[ALARM] Alarme disparado para ${tipoPausa}: ${tempoDecorrido}s / ${info.tempoLimite}s`);
    pausasAtivas.delete(tipoPausa);
    abrirPopupAlerta(tipoPausa, info.tempoLimite);
    registrarPausaExcedida(`Tempo de pausa (${tipoPausa}) excedido!`);
    salvarEstado();
  } else {
    console.warn(`[WARN] Alarme disparado para ${tipoPausa}, mas não está ativo`);
    recuperarPausaPerdida(tipoPausa);
  }
}

function atualizarTempoPausa(tipoPausa, sendResponse) {
  const tipoPausaUpper = tipoPausa.toUpperCase();
  if (pausasAtivas.has(tipoPausaUpper)) {
    const info = pausasAtivas.get(tipoPausaUpper);
    const tempoDecorrido = Math.floor((Date.now() - info.tempoInicio) / 1000);
    const tempoLimite = info.tempoLimite;
    const tempoRestante = Math.max(0, tempoLimite - tempoDecorrido);
    sendResponse({ tempoRestante: tempoRestante });
  } else {
    sendResponse({ tempoRestante: 0 });
  }
}

function abrirPopupAlerta(tipoPausa, tempoLimiteSegundos, mensagemCustomizada) {
  if (popupAberto) {
    console.log(`[DEBUG] Popup já aberto para ${tipoPausa || 'MicroSIP'}, ignorando nova tentativa`);
    return;
  }
  console.log(`[DEBUG] Tentando abrir popup para ${tipoPausa || 'MicroSIP'} com mensagem: ${mensagemCustomizada || tempoLimiteSegundos}`);

  chrome.windows.getAll({ populate: true }, (windows) => {
    const isMinimized = windows.every(win => win.state === "minimized");
    if (isMinimized) {
      chrome.windows.getCurrent((currentWindow) => {
        chrome.windows.update(currentWindow.id, { state: "normal" }, () => {
          if (chrome.runtime.lastError) {
            console.error("[ERROR] Falha ao restaurar janela:", chrome.runtime.lastError.message);
          } else {
            console.log("[SUCCESS] Janela restaurada de minimizado para normal");
          }
          criarPopup();
        });
      });
    } else {
      criarPopup();
    }
  });

  function criarPopup() {
    const mensagem = encodeURIComponent(mensagemCustomizada || `Tempo de pausa (${tipoPausa}) excedido! Limite: ${tempoLimiteSegundos / 60} minutos.`);
    chrome.windows.create({
      url: chrome.runtime.getURL("alert.html") + `?mensagem=${mensagem}&tipoPausa=${encodeURIComponent(tipoPausa || 'MicroSIP')}`,
      type: "popup",
      width: 400,
      height: 200,
      focused: true
    }, (window) => {
      if (chrome.runtime.lastError) {
        console.error("[ERROR] Erro ao criar popup:", chrome.runtime.lastError.message);
        popupAberto = false;
      } else {
        console.log("[SUCCESS] Popup criado com sucesso, ID:", window.id);
        popupAberto = true;
        if (abaMonitoradaId) {
          console.log(`[DEBUG] Tentando ativar aba ${abaMonitoradaId}`);
          chrome.tabs.update(abaMonitoradaId, { active: true }, (tab) => {
            if (chrome.runtime.lastError) {
              console.error("[ERROR] Erro ao ativar aba:", chrome.runtime.lastError.message);
            } else {
              console.log(`[SUCCESS] Aba ${abaMonitoradaId} ativada como complemento`);
            }
          });
        } else {
          console.warn("[WARN] Nenhuma aba monitorada para ativar");
        }
      }
    });
  }
}

function registrarPausaExcedida(mensagem) {
  const dataAtual = new Date().toLocaleString();
  console.log(`[DEBUG] Registrando pausa excedida: ${mensagem}`);
  chrome.storage.local.get(['historico'], (result) => {
    let historico = result.historico || [];
    historico.push({ mensagem, data: dataAtual });
    chrome.storage.local.set({ historico }, () => {
      console.log("[SUCCESS] Histórico atualizado");
    });
  });
}

function salvarEstado() {
  const alarmList = [];
  chrome.alarms.getAll((alarms) => {
    alarms.forEach(alarm => {
      if (pausasAtivas.has(alarm.name.toUpperCase())) {
        alarmList.push({ name: alarm.name, scheduledTime: alarm.scheduledTime });
      }
    });
    chrome.storage.local.set({
      pausasAtivas: Object.fromEntries(pausasAtivas),
      alarms: alarmList
    }, () => {
      console.log("[DEBUG] Estado de pausasAtivas e alarmes salvo:", pausasAtivas, alarmList);
    });
  });
}

function recuperarPausaPerdida(tipoPausa) {
  chrome.storage.local.get(['pausasAtivas'], (result) => {
    if (result.pausasAtivas && result.pausasAtivas[tipoPausa]) {
      console.log("[RECOVER] Recuperando pausa perdida:", tipoPausa, result.pausasAtivas[tipoPausa]);
      pausasAtivas.set(tipoPausa, result.pausasAtivas[tipoPausa]);
      const tempoRestante = Math.max(0, (result.pausasAtivas[tipoPausa].tempoLimite * 1000 + result.pausasAtivas[tipoPausa].tempoInicio - Date.now()) / 1000);
      if (tempoRestante > 0) {
        chrome.alarms.create(tipoPausa, { when: Date.now() + (tempoRestante * 1000) });
        console.log("[RECOVER] Alarme recriado para", tipoPausa, "com", tempoRestante, "segundos restantes");
        verificarPausasPendentes();
      } else {
        abrirPopupAlerta(tipoPausa, result.pausasAtivas[tipoPausa].tempoLimite);
        registrarPausaExcedida(`Tempo de pausa (${tipoPausa}) excedido!`);
        pausasAtivas.delete(tipoPausa);
      }
    } else {
      console.log("[WARN] Nenhuma pausa recuperada para", tipoPausa);
    }
  });
}

setInterval(salvarEstado, 10000);
console.log("[INIT] Service worker carregado:", Date.now());
verificarPausasPendentes();

// Helper functions
function handleWindowRemoved(windowId) {
  console.log(`[DEBUG] Janela fechada, ID: ${windowId}`);
  if (popupAberto) {
    chrome.windows.getAll({ populate: true }, (windows) => {
      const popupAindaAberto = windows.some(win => win.type === "popup" && win.id === windowId);
      if (!popupAindaAberto) {
        console.log("[DEBUG] Popup fechado, redefinindo popupAberto para false");
        popupAberto = false;
      }
    });
  }
}

function handleMessage(request, sendResponse) {
  console.log(`[DEBUG] Mensagem recebida: ${JSON.stringify(request)}`);
  try {
    switch (request.action) {
      case "iniciarTemporizador":
        iniciarTemporizador(request.tipoPausa);
        sendResponse({ success: true });
        break;
      case "pararTemporizador":
        pararTemporizador();
        sendResponse({ success: true });
        break;
      case "ativarServiceWorker":
      case "keepAlive":
        console.log("[KEEP-ALIVE] Service worker mantido ativo por content.js");
        verificarPausasPendentes();
        sendResponse({ success: true });
        break;
      case "atualizarTempo":
        atualizarTempoPausa(request.tipoPausa, sendResponse);
        break;
      case "microsipInactiveAlert":
        abrirPopupAlerta(null, null, "MicroSIP inativo! Por favor, verifique a conexão.");
        sendResponse({ success: true });
        break;
      case "popupClosed":
        console.log("[DEBUG] Recebida mensagem de popup fechado");
        popupAberto = false;
        sendResponse({ success: true });
        break;
      default:
        sendResponse({ success: false, error: "Ação desconhecida" });
    }
  } catch (error) {
    console.error("[ERROR] Erro ao processar mensagem:", error.message);
    sendResponse({ success: false, error: error.message });
  }
}

function clearExistingAlarms() {
  pausasAtivas.forEach((info, key) => {
    chrome.alarms.clear(key.toUpperCase());
    console.log(`[DEBUG] Alarme anterior de ${key} limpo para reiniciar`);
  });
}