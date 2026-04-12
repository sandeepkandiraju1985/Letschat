import { useEffect, useState } from 'react'



import socket from './lib/socket'
import './App.css'

type ChatMessage = {
    id: string
    content: string
    roomId: string
    createdAt: string
    sender?: {
        displayName?: string
    } | null
}


type Room = {
    id: string
    name: string
}
const NAME_COLORS = [
'#25D7F4', // IG cyan
  '#FFD400', // IG yellow
  '#FF0A78', // IG magenta
]

const SIDEBAR_COLORS = [
  '#25D7F4', // IG cyan
  '#FFD400', // IG yellow
  '#FF0A78', // IG magenta
]

function pickColor(value: string, palette: string[]) {
  let hash = 0

  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash)
  }

  return palette[Math.abs(hash) % palette.length]
}
function App() {


    const [guestToken, setGuestToken] = useState('')
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [messageInput, setMessageInput] = useState('')
    const [rooms, setRooms] = useState<Room[]>([])
    const [selectedRoomId, setSelectedRoomId] = useState('')
    const selectedRoom = rooms.find((room) => room.id === selectedRoomId)


    useEffect(() => {
        const fetchGuestToken = async () => {
            try {
                const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/guest`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        displayName: 'Sandeep Guest',
                    }),
                })

                if (!response.ok) {
                    throw new Error('Failed to create guest session')
                }

                const data = await response.json()
                setGuestToken(data.token)
                console.log('Guest token loaded')
            } catch (err) {
                console.error('Guest token fetch failed:', err)
            }
        }

        fetchGuestToken()
    }, [])

    useEffect(() => {
        const loadRooms = async () => {
            try {
                const response = await fetch(`${import.meta.env.VITE_API_URL}/rooms`)

                if (!response.ok) {
                    throw new Error('Failed to load rooms')
                }

                const data = await response.json()
                setRooms(data.rooms)

                const generalRoom = data.rooms.find((room: Room) => room.name === 'General')
                setSelectedRoomId(generalRoom?.id || data.rooms[0]?.id || '')
            } catch (err) {
                console.error('Load rooms failed:', err)
            }
        }

        loadRooms()
    }, [])

    useEffect(() => {
        if (!selectedRoomId) return
        setMessages([])
        const loadRoomMessages = async () => {
            try {
                const response = await fetch(
                    `${import.meta.env.VITE_API_URL}/rooms/${selectedRoomId}/messages`
                )

                if (!response.ok) {
                    throw new Error('Failed to load room messages')
                }

                const data = await response.json()
                setMessages(data.messages)
                console.log('Existing messages loaded:', data.messages.length)
            } catch (err) {
                console.error('Load room messages failed:', err)
            }
        }

        loadRoomMessages()
    }, [selectedRoomId])


    useEffect(() => {
        socket.connect();

        const onConnect = () => {
            console.log("Socket connected:", socket.id);
        };

        const onConnectError = (err: Error) => {
            console.error("Socket connect_error:", err.message);
        };

        const onJoinedRoom = (data: { roomId: string }) => {
            console.log("Joined room:", data.roomId);
        };

        const onNewRoomMessage = (message: ChatMessage) => {
            console.log("New room message:", message);
            setMessages((prev) => [...prev, message]);
        };

        const onSocketError = (data: { message: string }) => {
            console.error("Socket error:", data.message);
        };

        socket.on("connect", onConnect);
        socket.on("connect_error", onConnectError);
        socket.on("joined_room", onJoinedRoom);
        socket.on("new_room_message", onNewRoomMessage);
        socket.on("socket_error", onSocketError);

        return () => {
            socket.off("connect", onConnect);
            socket.off("connect_error", onConnectError);
            socket.off("joined_room", onJoinedRoom);
            socket.off("new_room_message", onNewRoomMessage);
            socket.off("socket_error", onSocketError);
            socket.disconnect();
        };
    }, []);

    useEffect(() => {
        if (!selectedRoomId) return;
        if (!socket.connected) return;

        socket.emit("join_room", selectedRoomId);
    }, [selectedRoomId]);

    const sendTestMessage = () => {
        if (!guestToken) {
            console.error('Guest token not ready yet')
            return
        }

        if (!messageInput.trim()) {
            return
        }

        if (!selectedRoomId) {
            return
        }
        
        socket.emit('send_room_message', {
            roomId: selectedRoomId,
            content: messageInput.trim(),
            token: guestToken,
        })

        setMessageInput('')
    }
    return (
  <div className="irc-layout">
    <aside className="irc-left">
    <div className="irc-left-top">
  <div className="irc-tool-row">
    <button className="irc-tool-btn">⚙</button>
    <button className="irc-tool-btn">🔔</button>
    <button className="irc-tool-btn">✉</button>
  </div>

  <div className="irc-user-card">
    <div className="irc-avatar-circle">G</div>
    <div>
      <div className="irc-user-name">Guest</div>
      <div className="irc-muted">online</div>
    </div>
  </div>
</div>

      <div className="irc-section">
        <div className="irc-section-title">CHANNELS</div>
        <div className="irc-channel-list">
          {rooms.length === 0 ? (
            <div className="irc-muted">Loading rooms...</div>
          ) : (
            rooms.map((room) => (
             <button
  key={room.id}
  className={`irc-channel-item ${room.id === selectedRoomId ? 'active' : ''}`}
  onClick={() => setSelectedRoomId(room.id)}
>
  <span
    className="irc-hash"
    style={{ color: pickColor(room.name, SIDEBAR_COLORS) }}
  >
    #
  </span>
  <span>{room.name}</span>
</button>
            ))
          )}
        </div>
      </div>

      <div className="irc-dm-item">
  <div
    className="irc-dm-avatar"
    style={{ color: pickColor('Akhil', SIDEBAR_COLORS) }}
  >
    A
  </div>
  <div className="irc-dm-name" style={{ color: pickColor('Akhil', SIDEBAR_COLORS) }}>
    Akhil
  </div>
  <div className="irc-dm-badge">2</div>
</div>

<div className="irc-dm-item">
  <div
    className="irc-dm-avatar"
    style={{ backgroundColor: '#334155', color: pickColor('Ravi', SIDEBAR_COLORS) }}
  >
    R
  </div>
  <div className="irc-dm-name" style={{ color: pickColor('Ravi', SIDEBAR_COLORS) }}>
    Ravi
  </div>
  <div className="irc-dm-badge">1</div>
</div>

<div className="irc-dm-item">
  <div
    className="irc-dm-avatar"
    style={{ backgroundColor: '#334155', color: pickColor('Sneha', SIDEBAR_COLORS) }}
  >
    S
  </div>
  <div className="irc-dm-name" style={{ color: pickColor('Sneha', SIDEBAR_COLORS) }}>
    Sneha
  </div>
</div>
 </aside>
    <main className="irc-center">
      <header className="irc-header">
        <div className="irc-room-title">
          #{selectedRoom?.name || 'Loading...'}
        </div>
        <div className="irc-room-subtitle">public room</div>
      </header>

      <section className="irc-messages">
        {messages.length === 0 ? (
          <div className="irc-empty">No messages yet</div>
        ) : (
          <ul className="irc-message-list">
            {messages.map((message) => (
<li key={message.id} className="irc-message-row">
  <div
    className="irc-message-avatar"
    style={{
      backgroundColor: `${pickColor(message.sender?.displayName || 'Guest', NAME_COLORS)}22`,
      color: pickColor(message.sender?.displayName || 'Guest', NAME_COLORS),
    }}
  >
    {(message.sender?.displayName || 'G').charAt(0).toUpperCase()}
  </div>

  <div className="irc-message-content-wrap">
    <div className="irc-message-meta">
      <span
        className="irc-message-author"
        style={{ color: pickColor(message.sender?.displayName || 'Guest', NAME_COLORS) }}
      >
        {message.sender?.displayName || 'Guest'}
      </span>
      <span className="irc-message-time">
        {new Date(message.createdAt).toLocaleTimeString([], {
  hour: '2-digit',
  minute: '2-digit',
})}
      </span>
    </div>

    <div className="irc-message-text">{message.content}</div>
  </div>
</li>
            ))}
          </ul>
        )}
      </section>

      <footer className="irc-composer">
        <div className="irc-composer-user">guest</div>

        <input
          type="text"
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          placeholder="Send a message..."
          className="irc-input"
        />

        <button
          className="irc-send"
          onClick={sendTestMessage}
          disabled={!guestToken || !selectedRoomId || !messageInput.trim()}
        >
          Send
        </button>
      </footer>
    </main>

    <aside className="irc-right">
      <div className="irc-right-header">
  <span>People here</span>
  <span className="irc-right-count">5</span>
</div>

      <div className="irc-people-list">
        <div className="irc-person-item">
          <div className="irc-person-avatar">G</div>
          <div className="irc-person-name">Guest</div>
        </div>

        <div className="irc-person-item">
          <div className="irc-person-avatar">A</div>
          <div className="irc-person-name">Akhil</div>
        </div>

        <div className="irc-person-item">
          <div className="irc-person-avatar">R</div>
          <div className="irc-person-name">Ravi</div>
        </div>

        <div className="irc-person-item">
          <div className="irc-person-avatar">S</div>
          <div className="irc-person-name">Sneha</div>
        </div>

        <div className="irc-person-item">
          <div className="irc-person-avatar">M</div>
          <div className="irc-person-name">Mayank</div>
        </div>
      </div>
    </aside>
  </div>
)
}
export default App
