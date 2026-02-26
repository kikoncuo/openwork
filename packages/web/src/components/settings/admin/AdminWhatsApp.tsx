import { useState, useEffect } from 'react'
import { AdminDataTable, type ColumnDef } from './AdminDataTable'
import type { AdminWhatsAppContact, AdminWhatsAppChat } from '@/types'

const PAGE_SIZE = 50

export function AdminWhatsApp() {
  const [contacts, setContacts] = useState<AdminWhatsAppContact[]>([])
  const [chats, setChats] = useState<AdminWhatsAppChat[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'contacts' | 'chats'>('contacts')
  const [contactOffset, setContactOffset] = useState(0)
  const [chatOffset, setChatOffset] = useState(0)

  useEffect(() => {
    loadData()
  }, [contactOffset, chatOffset])

  async function loadData() {
    setLoading(true)
    try {
      const [contactsData, chatsData] = await Promise.all([
        window.api.admin.getWhatsAppContacts(PAGE_SIZE, contactOffset),
        window.api.admin.getWhatsAppChats(PAGE_SIZE, chatOffset),
      ])
      setContacts(contactsData)
      setChats(chatsData)
    } catch (e) {
      console.error('Failed to load WhatsApp data:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdateContact(contact: AdminWhatsAppContact, key: string, value: string) {
    try {
      const result = await window.api.admin.updateRecord('whatsapp_contacts', contact.jid, { [key]: value })
      setContacts((prev) => prev.map((c) => (c.jid === contact.jid ? { ...c, ...result } as AdminWhatsAppContact : c)))
    } catch (e) {
      console.error('Failed to update contact:', e)
    }
  }

  async function handleUpdateChat(chat: AdminWhatsAppChat, key: string, value: string) {
    try {
      const result = await window.api.admin.updateRecord('whatsapp_chats', chat.jid, { [key]: value })
      setChats((prev) => prev.map((c) => (c.jid === chat.jid ? { ...c, ...result } as AdminWhatsAppChat : c)))
    } catch (e) {
      console.error('Failed to update chat:', e)
    }
  }

  const contactColumns: ColumnDef<AdminWhatsAppContact>[] = [
    {
      key: 'name',
      header: 'Name',
      editable: true,
    },
    {
      key: 'phone_number',
      header: 'Phone',
      render: (c) => <span className="font-mono text-xs">{c.phone_number || '-'}</span>,
    },
    {
      key: 'user_id',
      header: 'Owner',
      render: (c) => <span className="font-mono text-xs">{c.user_id.slice(0, 8)}...</span>,
    },
    {
      key: 'is_group',
      header: 'Group',
      render: (c) => c.is_group ? 'Yes' : 'No',
      className: 'w-16',
    },
  ]

  const chatColumns: ColumnDef<AdminWhatsAppChat>[] = [
    {
      key: 'name',
      header: 'Name',
      editable: true,
    },
    {
      key: 'jid',
      header: 'JID',
      render: (c) => <span className="font-mono text-xs truncate block max-w-[150px]">{c.jid}</span>,
    },
    {
      key: 'user_id',
      header: 'Owner',
      render: (c) => <span className="font-mono text-xs">{c.user_id.slice(0, 8)}...</span>,
    },
    {
      key: 'unread_count',
      header: 'Unread',
      className: 'w-16',
    },
    {
      key: 'last_message_time',
      header: 'Last Message',
      render: (c) => (
        <span className="text-xs text-muted-foreground">
          {c.last_message_time ? new Date(c.last_message_time).toLocaleString() : '-'}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setView('contacts')}
          className={`text-xs px-2 py-1 rounded ${
            view === 'contacts' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          Contacts
        </button>
        <button
          onClick={() => setView('chats')}
          className={`text-xs px-2 py-1 rounded ${
            view === 'chats' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          Chats
        </button>
      </div>

      {view === 'contacts' ? (
        <AdminDataTable
          columns={contactColumns}
          data={contacts}
          loading={loading}
          keyField="jid"
          emptyMessage="No WhatsApp contacts found"
          filterPlaceholder="Search contacts..."
          pagination={{ offset: contactOffset, pageSize: PAGE_SIZE, onOffsetChange: setContactOffset, hasMore: contacts.length === PAGE_SIZE }}
          onUpdate={handleUpdateContact}
        />
      ) : (
        <AdminDataTable
          columns={chatColumns}
          data={chats}
          loading={loading}
          keyField="jid"
          emptyMessage="No WhatsApp chats found"
          filterPlaceholder="Search chats..."
          pagination={{ offset: chatOffset, pageSize: PAGE_SIZE, onOffsetChange: setChatOffset, hasMore: chats.length === PAGE_SIZE }}
          onUpdate={handleUpdateChat}
        />
      )}
    </div>
  )
}
