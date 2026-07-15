/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

import { ChatService } from './chat.service';
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';
import { COPILOT_CONFIG, DEFAULT_COPILOT_CONFIG } from '../copilot.config';
import { McpStreamEvent } from '../core/models/mcp-response.model';
import { CopilotContext } from '../core/models/copilot-context.model';

describe('ChatService', () => {
  let service: ChatService;
  let httpMock: HttpTestingController;
  let sendMessageMock: jest.Mock;
  let handleToolCallMock: jest.Mock;
  const context: CopilotContext = {
    clientId: 42,
    clientName: 'Rajesh Kumar',
    loanId: null,
    screen: 'client-detail',
    loggedInUser: 'priya',
    role: 'Loan Officer',
    language: 'en'
  };

  beforeEach(() => {
    localStorage.clear();
    sendMessageMock = jest.fn();
    handleToolCallMock = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        ChatService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: COPILOT_CONFIG, useValue: DEFAULT_COPILOT_CONFIG },
        {
          provide: McpClientService,
          useValue: { sendMessage: sendMessageMock, handleToolCall: handleToolCallMock }
        },
        { provide: AiContextService, useValue: { getContextSnapshot: () => context } }
      ]
    });
    service = TestBed.inject(ChatService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    jest.restoreAllMocks();
  });

  function flushPersist(): void {
    const req = httpMock.expectOne(`${DEFAULT_COPILOT_CONFIG.mcpBaseUrl}/api/chat/history/priya`);
    expect(req.request.method).toBe('PUT');
    req.flush(null);
  }

  it('appends the user message then streams tokens into the assistant message', async () => {
    const events: McpStreamEvent[] = [
      { type: 'token', token: 'Hello ' },
      { type: 'token', token: 'there' },
      { type: 'done' }
    ];
    sendMessageMock.mockReturnValue(of(...events));

    await service.sendMessage('  What is the balance? ');
    flushPersist();

    const messages = service.messages$.value;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'What is the balance?', clientId: 42 });
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Hello there', isStreaming: false });
  });

  it('blocks messages that fail sanitization and never calls MCP', async () => {
    await service.sendMessage('a'.repeat(600));

    expect(sendMessageMock).not.toHaveBeenCalled();
    const messages = service.messages$.value;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('system');
  });

  it('parses action_card and suggest blocks out of the assembled text', async () => {
    const card = '```action_card\n{"type":"client","title":"Rajesh Kumar","data":{"Balance":"100"}}\n```';
    const suggest = '```suggest\n- Show overdue loans\n```';
    sendMessageMock.mockReturnValue(of<McpStreamEvent>({ type: 'token', token: `Summary. ${card}${suggest}` }));

    await service.sendMessage('Show client');
    flushPersist();

    const assistant = service.messages$.value[1];
    expect(assistant.content).toBe('Summary.');
    expect(assistant.actionCards).toEqual([{ type: 'client', title: 'Rajesh Kumar', data: { Balance: '100' } }]);
    expect(assistant.suggestedPrompts).toEqual(['Show overdue loans']);
  });

  it('routes tool_call events to McpClientService.handleToolCall and records toolUsed', async () => {
    const toolCallEvent: McpStreamEvent = { type: 'tool_call', toolName: 'record_repayment', toolArgs: { loanId: 1 } };
    const events: McpStreamEvent[] = [
      toolCallEvent,
      { type: 'token', token: 'Done.' }
    ];
    sendMessageMock.mockReturnValue(of(...events));

    await service.sendMessage('Record repayment');
    flushPersist();

    expect(handleToolCallMock).toHaveBeenCalledWith(toolCallEvent);
    expect(service.messages$.value[1].toolUsed).toBe('record_repayment');
  });

  it('shows a fallback message and stops streaming when the MCP stream errors', async () => {
    sendMessageMock.mockReturnValue(throwError(() => new Error('network down')));

    await service.sendMessage('Hello');
    flushPersist();

    const assistant = service.messages$.value[1];
    expect(assistant.isStreaming).toBe(false);
    expect(assistant.content).toBe('Sorry, something went wrong. Please try again.');
  });

  it('ignores a second sendMessage while one is still streaming', async () => {
    const subject = new Subject<McpStreamEvent>();
    sendMessageMock.mockReturnValue(subject.asObservable());

    const first = service.sendMessage('First');
    await service.sendMessage('Second');
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    subject.next({ type: 'token', token: 'Reply' });
    subject.complete();
    await first;
    flushPersist();

    expect(service.messages$.value).toHaveLength(2);
  });

  it('stopStreaming unsubscribes and marks the in-flight assistant message as done', async () => {
    const subject = new Subject<McpStreamEvent>();
    sendMessageMock.mockReturnValue(subject.asObservable());

    const pending = service.sendMessage('Hello');
    expect(service.messages$.value[1].isStreaming).toBe(true);

    service.stopStreaming();
    expect(service.messages$.value[1].isStreaming).toBe(false);

    subject.complete();
    await pending;
  });

  it('clearChat resets the message list and allows a new send afterwards', async () => {
    sendMessageMock.mockReturnValue(of<McpStreamEvent>({ type: 'token', token: 'Hi' }));
    await service.sendMessage('Hello');
    flushPersist();
    expect(service.messages$.value).toHaveLength(2);

    service.clearChat();
    expect(service.messages$.value).toHaveLength(0);

    sendMessageMock.mockReturnValue(of<McpStreamEvent>({ type: 'token', token: 'Hi again' }));
    await service.sendMessage('Hello again');
    flushPersist();
    expect(service.messages$.value).toHaveLength(2);
  });

  it('loadHistory fetches conversations from the server and mirrors them to localStorage', async () => {
    const remote = [{ id: 'session-1', title: 'Old chat', preview: '...', timestamp: 1, messageCount: 2 }];

    const promise = service.loadHistory();
    const req = httpMock.expectOne(`${DEFAULT_COPILOT_CONFIG.mcpBaseUrl}/api/chat/history/priya`);
    expect(req.request.method).toBe('GET');
    req.flush(remote);
    await promise;

    expect(service.conversations$.value).toEqual(remote);
    expect(localStorage.setItem).toHaveBeenCalledWith('copilot_chat_conversations', JSON.stringify(remote));
  });

  it('loadHistory falls back to localStorage when the server request fails', async () => {
    const cached = [{ id: 'session-2', title: 'Cached chat', preview: '...', timestamp: 2, messageCount: 1 }];
    (localStorage.getItem as jest.Mock).mockReturnValue(JSON.stringify(cached));

    const promise = service.loadHistory();
    const req = httpMock.expectOne(`${DEFAULT_COPILOT_CONFIG.mcpBaseUrl}/api/chat/history/priya`);
    req.error(new ProgressEvent('network error'));
    await promise;

    expect(service.conversations$.value).toEqual(cached);
  });
});
