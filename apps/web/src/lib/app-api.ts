import { z } from 'zod';
import {
  dashboardSummarySchema,
  conversationListItemSchema,
  messageSchema,
  teamMemberSchema,
  contactSchema,
  appointmentSchema,
  weeklyStatsSchema,
  organizationDetailSchema,
  aiTestResultSchema,
  type DashboardSummaryDto,
  type ConversationListItem,
  type ConversationStatus,
  type MessageDto,
  type TeamMemberDto,
  type ContactDto,
  type AppointmentDto,
  type WeeklyStats,
  type OrganizationDetailDto,
  type AiTestResultDto,
} from '@waos/shared';
import { apiFetch } from './api';

export async function getDashboardSummary(): Promise<DashboardSummaryDto> {
  const raw = await apiFetch<unknown>('/api/v1/dashboard');
  return dashboardSummarySchema.parse((raw as { summary: unknown }).summary);
}

export async function listConversations(
  status?: ConversationStatus,
): Promise<ConversationListItem[]> {
  const params = new URLSearchParams();
  if (status) {
    params.append('status', status);
  }
  const query = params.toString();
  const raw = await apiFetch<unknown>(`/api/v1/conversations${query ? `?${query}` : ''}`);
  return z.array(conversationListItemSchema).parse((raw as { conversations: unknown }).conversations);
}

export async function listMessages(conversationId: string): Promise<MessageDto[]> {
  const raw = await apiFetch<unknown>(`/api/v1/conversations/${conversationId}/messages`);
  return z.array(messageSchema).parse((raw as { messages: unknown }).messages);
}

export async function listTeam(): Promise<TeamMemberDto[]> {
  const raw = await apiFetch<unknown>('/api/v1/organization/users');
  return z.array(teamMemberSchema).parse((raw as { users: unknown }).users);
}

export async function listContacts(search?: string, tag?: string): Promise<ContactDto[]> {
  const params = new URLSearchParams();
  if (search) {
    params.append('search', search);
  }
  if (tag) {
    params.append('tag', tag);
  }
  const query = params.toString();
  const raw = await apiFetch<unknown>(`/api/v1/contacts${query ? `?${query}` : ''}`);
  return z.array(contactSchema).parse((raw as { contacts: unknown }).contacts);
}

export async function listAppointments(from?: string): Promise<AppointmentDto[]> {
  const params = new URLSearchParams();
  if (from) {
    params.append('from', from);
  }
  const query = params.toString();
  const raw = await apiFetch<unknown>(`/api/v1/appointments${query ? `?${query}` : ''}`);
  return z.array(appointmentSchema).parse((raw as { appointments: unknown }).appointments);
}

export async function getWeeklyStats(): Promise<WeeklyStats> {
  const raw = await apiFetch<unknown>('/api/v1/appointments/stats/weekly');
  return weeklyStatsSchema.parse((raw as { stats: unknown }).stats);
}

export async function getOrganization(): Promise<OrganizationDetailDto> {
  const raw = await apiFetch<unknown>('/api/v1/organization');
  return organizationDetailSchema.parse((raw as { organization: unknown }).organization);
}

export async function runAiTest(question: string): Promise<AiTestResultDto> {
  const raw = await apiFetch<unknown>('/api/v1/ai/test', {
    method: 'POST',
    body: { question },
  });
  return aiTestResultSchema.parse((raw as { result: unknown }).result);
}
