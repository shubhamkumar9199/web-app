/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import { ChatService } from './chat.service';
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';
import { AuthenticationService } from '../../core/authentication/authentication.service';
import { McpStreamEvent } from '../core/models/mcp-response.model';
import { CopilotContext } from '../core/models/copilot-context.model';

describe('ChatService', () => {
  let service: ChatService;
  let mcpClientServiceMock: { sendMessage: jest.Mock; handleToolCall: jest.Mock };
  let httpClientMock: { get: jest.Mock };
  let credentials: { userId: number } | null;

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
    credentials = { userId: 7 };
    mcpClientServiceMock = {
      sendMessage: jest.fn(),
      handleToolCall: jest.fn()
    };
    httpClientMock = {
      get: jest.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        ChatService,
        { provide: McpClientService, useValue: mcpClientServiceMock },
        { provide: AiContextService, useValue: { getContextSnapshot: () => context } },
        { provide: AuthenticationService, useValue: { getCredentials: () => credentials } },
        { provide: HttpClient, useValue: httpClientMock }
      ]
    });
    service = TestBed.inject(ChatService);
  });

  function emitStream(events: McpStreamEvent[]): Subject<McpStreamEvent> {
    const subject = new Subject<McpStreamEvent>();
    mcpClientServiceMock.sendMessage.mockReturnValue(subject);
    queueMicrotask(() => {
      events.forEach((event) => subject.next(event));
      subject.complete();
    });
    return subject;
  }

  it('blocks input that fails sanitization and never calls the MCP client', async () => {
    await service.sendMessage('   ');
    expect(mcpClientServiceMock.sendMessage).not.toHaveBeenCalled();
    const messages = service.messages$.value;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('system');
  });

  it('appends the sanitized user message before streaming', async () => {
    emitStream([{ type: 'done' }]);
    await service.sendMessage('What is the balance on loan 107?');
    const messages = service.messages$.value;
    expect(messages[0]).toMatchObject({ role: 'user', content: 'What is the balance on loan 107?' });
    expect(mcpClientServiceMock.sendMessage).toHaveBeenCalledWith('What is the balance on loan 107?', context);
  });

  it('accumulates streamed tokens into the assistant message and clears isStreaming on completion', async () => {
    emitStream([
      { type: 'token', token: 'The balance is ' },
      { type: 'token', token: '$500.' }
    ]);
    await service.sendMessage('balance?');
    const messages = service.messages$.value;
    const assistant = messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe('The balance is $500.');
    expect(assistant.isStreaming).toBe(false);
  });

  it('extracts action cards emitted from fenced blocks in the streamed text', async () => {
    emitStream([
      {
        type: 'token',
        token: 'Here it is.\n```action_card\n{"type":"loan","title":"Loan #107","data":{"Balance":"500"}}\n```'
      }
    ]);
    await service.sendMessage('show loan 107');
    const assistant = service.messages$.value[1];
    expect(assistant.content).toBe('Here it is.');
    expect(assistant.actionCards).toHaveLength(1);
    expect(assistant.actionCards?.[0].title).toBe('Loan #107');
  });

  it('records the tool used and delegates tool_call events to the MCP client', async () => {
    emitStream([{ type: 'tool_call', toolName: 'view_loan_details', toolArgs: { loanId: 107 } }]);
    await service.sendMessage('show loan 107');
    const assistant = service.messages$.value[1];
    expect(assistant.toolUsed).toBe('view_loan_details');
    expect(mcpClientServiceMock.handleToolCall).toHaveBeenCalledWith({
      type: 'tool_call',
      toolName: 'view_loan_details',
      toolArgs: { loanId: 107 }
    });
  });

  it('surfaces a server error message and stops streaming', async () => {
    emitStream([{ type: 'error', message: 'MCP server unavailable' }]);
    await service.sendMessage('hello');
    const assistant = service.messages$.value[1];
    expect(assistant.content).toBe('MCP server unavailable');
    expect(assistant.isStreaming).toBe(false);
  });

  it('finalizes gracefully when the stream itself errors', async () => {
    mcpClientServiceMock.sendMessage.mockReturnValue(throwError(() => new Error('network down')));
    await expect(service.sendMessage('hello')).resolves.toBeUndefined();
    const assistant = service.messages$.value[1];
    expect(assistant.isStreaming).toBe(false);
  });

  it('stopStreaming unsubscribes and marks the in-flight message as no longer streaming', async () => {
    const subject = new Subject<McpStreamEvent>();
    mcpClientServiceMock.sendMessage.mockReturnValue(subject);
    const pending = service.sendMessage('hello');
    subject.next({ type: 'token', token: 'partial' });

    service.stopStreaming();

    const assistant = service.messages$.value[1];
    expect(assistant.isStreaming).toBe(false);
    subject.complete();
    await pending;
  });

  it('clearChat resets the message list', async () => {
    emitStream([{ type: 'done' }]);
    await service.sendMessage('hello');
    expect(service.messages$.value.length).toBeGreaterThan(0);

    service.clearChat();
    expect(service.messages$.value).toEqual([]);
  });

  it('loadHistory falls back to an empty list when there is no logged-in user', async () => {
    credentials = null;
    await service.loadHistory();
    expect(httpClientMock.get).not.toHaveBeenCalled();
    expect(service.conversations$.value).toEqual([]);
  });

  it('loadHistory fetches from the MCP server for the logged-in user', async () => {
    const remote = [
      { id: 'c1', title: 'Loan question', preview: 'Balance is 500', timestamp: 1719360000000, messageCount: 2 }
    ];
    httpClientMock.get.mockReturnValue(of(remote));
    await service.loadHistory();
    expect(httpClientMock.get).toHaveBeenCalledWith(expect.stringContaining('/api/chat/history/7'));
    expect(service.conversations$.value).toEqual(remote);
  });

  it('loadHistory falls back to an empty list when the server call fails', async () => {
    httpClientMock.get.mockReturnValue(throwError(() => new Error('offline')));
    await service.loadHistory();
    expect(service.conversations$.value).toEqual([]);
  });
});
