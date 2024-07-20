import express from "express";
import cors from "cors";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import { ElevenLabsClient } from "elevenlabs";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { exec } from "child_process";
import { promises as fs } from "fs";

const app = express();
dotenv.config();
const port = process.env.PORT || 3001;

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(bodyParser.json());

const MODEL_NAME = "gemini-1.5-pro";
const API_KEY = process.env.API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

if (!ELEVENLABS_API_KEY) {
  throw new Error("Missing ELEVENLABS_API_KEY in environment variables");
}

const elevenLabsClient = new ElevenLabsClient({
  apiKey: ELEVENLABS_API_KEY,
});

async function runChat(userInput) {
  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction:
      "You are Shahad, everybody's friend. Conversation and response should be like talking to a real friend and it should be casual\n",
  });

  const generationConfig = {
    temperature: 2,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 8192,
    responseMimeType: "text/plain",
  };

  const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
  ];

  const chat = model.startChat({
    generationConfig,
    safetySettings,
    history: [
      {
        role: "user",
        parts: [
          {
            text: userInput,
          },
        ],
      },
      // Add your predefined chat history here
    ],
  });

  const result = await chat.sendMessage(userInput);
  const response = result.response;
  return response.text();
}

async function createAudioStreamFromText(text) {
  const audioStream = await elevenLabsClient.generate({
    voice: "Bill",
    model_id: "eleven_turbo_v2_5",
    text,
  });

  const chunks = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }

  const content = Buffer.concat(chunks);
  return content;
}

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const convertMp3ToWav = async (fileName) => {
  const wavFileName = fileName.replace(".mp3", ".wav");
  await execCommand(`ffmpeg -y -i ${fileName} ${wavFileName}`);
  return wavFileName;
};

const generateLipSyncData = async (wavFileName) => {
  const jsonFileName = wavFileName.replace(".wav", ".json");
  await execCommand(
    `rhubarb -f json -o ${jsonFileName} ${wavFileName} -r phonetic`
  );
  const data = await fs.readFile(jsonFileName, "utf8");
  return JSON.parse(data);
};

app.post("/chat", async (req, res) => {
  try {
    const userInput = req.body?.userInput;
    console.log("incoming /chat req", userInput);
    if (!userInput) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    const chatResponse = await runChat(userInput);
    const audioContent = await createAudioStreamFromText(chatResponse);
    const audioFileName = "output.mp3";
    await fs.writeFile(audioFileName, audioContent);
    const wavFileName = await convertMp3ToWav(audioFileName);
    const lipSyncData = await generateLipSyncData(wavFileName);

    res.setHeader("Content-Type", "application/json");
    res.json({
      text: chatResponse,
      audio: audioContent.toString("base64"),
      lipsync: lipSyncData,
    });
  } catch (error) {
    console.error("Error in chat endpoint:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
