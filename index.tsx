/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Chat,
  FunctionDeclaration,
  GoogleGenAI,
  Tool,
  Type,
} from '@google/genai';

// --- DOM ELEMENT REFERENCES ---
const promptForm = document.getElementById('prompt-form') as HTMLFormElement;
const promptInput = document.getElementById('prompt-input') as HTMLInputElement;
const chatHistory = document.getElementById('chat-history') as HTMLDivElement;
const submitButton = promptForm.querySelector('button')!;
const modal = document.getElementById('confirmation-modal') as HTMLDivElement;
const modalOverlay = document.getElementById('modal-overlay') as HTMLDivElement;
const modalBody = document.getElementById('modal-body') as HTMLDivElement;
const confirmBtn = document.getElementById('modal-confirm-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('modal-cancel-btn') as HTMLButtonElement;

// --- STATE MANAGEMENT ---
// Tracks the details of an action awaiting modal confirmation.
let actionToConfirm: { type: string; [key: string]: any } | null = null;

// --- MOCK API IMPLEMENTATIONS ---
const mockApi = {
  getNodeStatus: (nodeId: string): string => {
    if (nodeId === 'ana-agi-node-1') {
      const response = {
        id: nodeId,
        status: 'Active',
        version: '2.0.0 G-Sync',
        cpu_load: 12.0,
      };
      return `Status for node ${response.id}:\n- Status: ${response.status}\n- Version: ${response.version}\n- CPU Load: ${response.cpu_load}%`;
    }
    return `Error fetching status for ${nodeId}: Node not found.`;
  },
  getLatestVaultLogs: (limit: number): string => {
    const logs = [
      {
        timestamp: new Date(Date.now() - 10000).toISOString(),
        level: 'INFO',
        message: 'System compliance check passed.',
      },
      {
        timestamp: new Date(Date.now() - 30000).toISOString(),
        level: 'ERROR',
        message: 'Connection to database failed.',
      },
      {
        timestamp: new Date(Date.now() - 60000).toISOString(),
        level: 'INFO',
        message: 'Deployment of package 1.9.9 started on ana-agi-node-1.',
      },
      {
        timestamp: new Date(Date.now() - 120000).toISOString(),
        level: 'WARN',
        message: 'High CPU usage detected on node-2.',
      },
      {
        timestamp: new Date(Date.now() - 300000).toISOString(),
        level: 'INFO',
        message: 'User "admin" logged in.',
      },
    ];
    const response = logs.slice(0, limit);
    const formattedLogs = response
      .map((log) => `- [${log.level}] ${log.message}`)
      .join('\n');
    return `Last ${limit} logs from the Vault:\n${formattedLogs}`;
  },
  getSystemComplianceScore: (): string => {
    const response = { score: 98.5 };
    return `Current system compliance score is: ${response.score}%`;
  },
  startDeployment: (packageId: string, nodeId: string): string => {
    actionToConfirm = {
      type: 'DEPLOYMENT',
      packageId,
      nodeId,
    };
    modalBody.innerHTML = `<p>Are you sure you want to deploy package <strong>${packageId}</strong> to node <strong>${nodeId}</strong>?</p><p>This action will change the state of the system.</p>`;
    modal.classList.remove('hidden');
    modalOverlay.classList.remove('hidden');
    return `Please confirm the deployment in the dialog box.`;
  },
};

// --- GEMINI FUNCTION DECLARATIONS ---
const nunDashboardTools: Tool = {
  functionDeclarations: [
    {
      name: 'getNodeStatus',
      description:
        'Gets the real-time status, version, and CPU load for a specific node in the NuN network.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          nodeId: {
            type: Type.STRING,
            description: 'The identifier of the node, e.g., ana-agi-node-1',
          },
        },
        required: ['nodeId'],
      },
    },
    {
      name: 'getLatestVaultLogs',
      description: 'Retrieves the most recent log events from the NuN Vault.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          limit: {
            type: Type.INTEGER,
            description: 'The number of log entries to retrieve, e.g., 5',
          },
        },
        required: ['limit'],
      },
    },
    {
      name: 'getSystemComplianceScore',
      description: 'Returns the current overall compliance score of the entire NuN system.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: 'startDeployment',
      description: 'Initiates the deployment procedure of a specific package to a target node.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          packageId: {
            type: Type.STRING,
            description: 'The package version to deploy, e.g., 2.0.0 G-Sync',
          },
          nodeId: {
            type: Type.STRING,
            description: 'The target node for the deployment',
          },
        },
        required: ['packageId', 'nodeId'],
      },
    },
  ],
};

/**
 * Appends a message to the chat history UI.
 * @param content The text content of the message.
 * @param cssClass The CSS class to apply ('user-message' or 'model-message').
 */
function appendMessage(content: string, cssClass: 'user-message' | 'model-message') {
  const messageDiv = document.createElement('div');
  messageDiv.classList.add('message', cssClass);

  if (cssClass === 'model-message' && (content.startsWith('{') || content.startsWith('['))) {
    try {
      const formattedJson = JSON.stringify(JSON.parse(content), null, 2);
      messageDiv.innerHTML = `<pre><code>${formattedJson}</code></pre>`;
    } catch {
      messageDiv.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit; background: none; padding: 0;">${content}</pre>`;
    }
  } else {
    messageDiv.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit; background: none; padding: 0;">${content}</pre>`;
  }
  
  chatHistory.appendChild(messageDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

/**
 * Manages the loading indicator in the UI.
 */
const loadingIndicator = {
  element: null as HTMLElement | null,
  show: () => {
    if (!loadingIndicator.element) {
      loadingIndicator.element = document.createElement('div');
      loadingIndicator.element.classList.add('loading-spinner');
      chatHistory.appendChild(loadingIndicator.element);
      chatHistory.scrollTop = chatHistory.scrollHeight;
    }
  },
  hide: () => {
    if (loadingIndicator.element) {
      loadingIndicator.element.remove();
      loadingIndicator.element = null;
    }
  },
};

/**
 * Main application logic.
 */
async function main() {
  if (!process.env.API_KEY) {
    appendMessage(
      'ERROR: API_KEY is not configured. Please set it in the environment variables.',
      'model-message'
    );
    return;
  }

  // --- MODAL EVENT LISTENERS ---
  function hideModal() {
    modal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
    actionToConfirm = null;
  }

  confirmBtn.addEventListener('click', () => {
    if (actionToConfirm && actionToConfirm.type === 'DEPLOYMENT') {
      const { packageId, nodeId } = actionToConfirm;
      // The actual "API call" that performs the action
      const result = `✅ Deployment of package '${packageId}' successfully initiated on node '${nodeId}'.`;
      appendMessage(result, 'model-message');
    }
    hideModal();
  });

  cancelBtn.addEventListener('click', () => {
    appendMessage('❌ Deployment action was cancelled by the user.', 'model-message');
    hideModal();
  });

  modalOverlay.addEventListener('click', () => {
    appendMessage('❌ Deployment action was cancelled by the user.', 'model-message');
    hideModal();
  });

  // Prevent clicks inside the modal from closing it
  modal.addEventListener('click', (e) => e.stopPropagation());

  // --- GEMINI SETUP ---
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const chat: Chat = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      tools: [nunDashboardTools],
    },
  });

  // --- FORM SUBMISSION ---
  promptForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userMessage = promptInput.value.trim();
    if (!userMessage) return;

    promptInput.value = '';
    promptInput.disabled = true;
    submitButton.disabled = true;

    appendMessage(userMessage, 'user-message');
    loadingIndicator.show();

    try {
      let response = await chat.sendMessage({ message: userMessage });

      while (response.functionCalls && response.functionCalls.length > 0) {
        const functionResponses = [];

        for (const funcCall of response.functionCalls) {
          const { name, args } = funcCall;
          if (name in mockApi) {
            const result = (mockApi as any)[name](...Object.values(args));
            functionResponses.push({
              name,
              response: { result },
            });
          }
        }
        
        response = await chat.sendMessage({
          message: functionResponses.map((functionResponse) => ({
            functionResponse,
          })),
        });
      }

      loadingIndicator.hide();
      if (response.text) {
        appendMessage(response.text, 'model-message');
      }
    } catch (error) {
      console.error(error);
      loadingIndicator.hide();
      appendMessage(`Error: ${(error as Error).message}`, 'model-message');
    } finally {
      promptInput.disabled = false;
      submitButton.disabled = false;
      promptInput.focus();
    }
  });
}

main();