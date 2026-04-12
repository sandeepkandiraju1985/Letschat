import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config();

const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  credentials: true,
};

const app = express();
app.set("trust proxy", 1);
app.use(cors(corsOptions));
app.use(express.json());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: corsOptions,
});

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join_room", (roomId: string) => {
    if (!roomId?.trim()) return;

    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room ${roomId}`);
    socket.emit("joined_room", { roomId });
  });

  socket.on(
    "send_room_message",
    async (payload: { roomId: string; content: string; token: string }) => {
      try {
        const { roomId, content, token } = payload;

        if (!roomId || !content?.trim() || !token) {
          socket.emit("socket_error", {
            message: "roomId, content, and token are required",
          });
          return;
        }

        const decoded = jwt.verify(token, JWT_SECRET) as {
          userId: string;
        };

        const room = await prisma.room.findUnique({
          where: { id: roomId },
          select: { id: true },
        });

        if (!room) {
          socket.emit("socket_error", { message: "Room not found" });
          return;
        }

        const message = await prisma.message.create({
          data: {
            content: content.trim(),
            roomId,
            senderId: decoded.userId,
          },
          select: {
            id: true,
            content: true,
            createdAt: true,
            roomId: true,
            sender: {
              select: {
                id: true,
                displayName: true,
                isGuest: true,
              },
            },
          },
        });

        io.to(roomId).emit("new_room_message", message);
      } catch (error) {
        console.error("Socket send_room_message error:", error);
        socket.emit("socket_error", { message: "Failed to send message" });
      }
    }
  );

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

app.get("/", (_req, res) => {
  res.send("Letschat server is running");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Database connection failed:", error);
    res.status(500).json({
      status: "error",
      database: "not connected",
    });
  }
});

app.post("/auth/signup", async (req, res) => {
  try {
    const { email, password, displayName } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
    };

    if (!email || !password || !displayName) {
      return res.status(400).json({
        message: "Email, password, and displayName are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return res.status(409).json({
        message: "User already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        displayName: displayName.trim(),
        isGuest: false,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        isGuest: true,
        createdAt: true,
      },
    });

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      message: "Signup successful",
      token,
      user,
    });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (user.status === "BANNED") {
      return res.status(403).json({
        message: "Your account is banned",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        isGuest: user.isGuest,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.post("/auth/guest", async (req, res) => {
  try {
    const { displayName } = req.body as {
      displayName?: string;
    };

    if (!displayName || !displayName.trim()) {
      return res.status(400).json({
        message: "displayName is required",
      });
    }

    const guestName = displayName.trim();

    const user = await prisma.user.create({
      data: {
        displayName: guestName,
        isGuest: true,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        isGuest: true,
        createdAt: true,
      },
    });

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        isGuest: true,
      },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(201).json({
      message: "Guest login successful",
      token,
      user,
    });
  } catch (error) {
    console.error("Guest login error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.get("/auth/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authorization token is missing",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email?: string;
      role?: string;
      isGuest?: boolean;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        isGuest: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      user,
    });
  } catch (error) {
    console.error("Auth me error:", error);
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
});

app.get("/rooms", async (_req, res) => {
  try {
    const rooms = await prisma.room.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        isPublic: true,
        createdAt: true,
      },
    });

    return res.status(200).json({ rooms });
  } catch (error) {
    console.error("Get rooms error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.post("/rooms", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authorization token is missing",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
    };

    const { name, description } = req.body as {
      name?: string;
      description?: string;
    };

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Room name is required",
      });
    }

    const room = await prisma.room.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        isPublic: true,
        createdById: decoded.userId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        isPublic: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      message: "Room created successfully",
      room,
    });
  } catch (error: any) {
    console.error("Create room error:", error);

    if (error?.code === "P2002") {
      return res.status(409).json({
        message: "Room name already exists",
      });
    }

    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.get("/rooms/:roomId/messages", async (req, res) => {
  try {
    const { roomId } = req.params;

    const messages = await prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        content: true,
        createdAt: true,
        sender: {
          select: {
            id: true,
            displayName: true,
            isGuest: true,
          },
        },
      },
    });

    return res.status(200).json({ messages });
  } catch (error) {
    console.error("Get room messages error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.post("/rooms/:roomId/messages", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authorization token is missing",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
    };

    const { roomId } = req.params;
    const { content } = req.body as {
      content?: string;
    };

    if (!content || !content.trim()) {
      return res.status(400).json({
        message: "Message content is required",
      });
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true },
    });

    if (!room) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    const message = await prisma.message.create({
      data: {
        content: content.trim(),
        roomId,
        senderId: decoded.userId,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        roomId: true,
        sender: {
          select: {
            id: true,
            displayName: true,
            isGuest: true,
          },
        },
      },
    });

    return res.status(201).json({
      message: "Message sent successfully",
      messageData: message,
    });
  } catch (error) {
    console.error("Send room message error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

const shutdown = async () => {
  console.log("Shutting down server...");
  await prisma.$disconnect();
  httpServer.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});