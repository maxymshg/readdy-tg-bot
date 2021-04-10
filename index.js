const { Telegraf } = require("telegraf");
const { Readability } = require("@mozilla/readability");
const axios = require("axios").default;
const JSDOM = require("jsdom").JSDOM;
const {
  PollyClient,
  StartSpeechSynthesisTaskCommand,
  GetSpeechSynthesisTaskCommand,
} = require("@aws-sdk/client-polly");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const pollyClient = new PollyClient({ region: "eu-west-2" });
const s3 = new S3Client({ region: "eu-west-2" });

const token = process.env.BOT_TOKEN;
if (token === undefined) {
  throw new Error("BOT_TOKEN must be provided!");
}
const voiceId = process.env.POLLY_VOICE_ID;
if (voiceId === undefined) {
  throw new Error("POLLY_VOICE_ID must be provided!");
}

const getReaderView = async (url) => {
  console.log("URL:", JSON.stringify(url));
  const articleSite = await axios.get(url);
  const vdom = new JSDOM(articleSite.data);
  const reader = new Readability(vdom.window.document);
  return reader.parse();
};

const waitforme = (milisec) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("");
    }, milisec);
  });
};

const startSpeechTask = async (text) => {
  console.log("ST", JSON.stringify(text));
  try {
    const command = new StartSpeechSynthesisTaskCommand({
      Text: text,
      OutputFormat: "mp3",
      VoiceId: voiceId,
      OutputS3BucketName: "readdy-voice-content",
    });
    const data = await pollyClient.send(command);
    console.log("ST.RES:", JSON.stringify(data));
    let task = null;
    for (let i = 0; i < 10; i++) {
      task = await pollyClient.send(
        new GetSpeechSynthesisTaskCommand({ TaskId: data.SynthesisTask.TaskId })
      );
      console.log("Task: ", JSON.stringify(task));
      if (task.SynthesisTask.TaskStatus === "completed") {
        break;
      }
      await waitforme(5000);
    }
    return task;
    // process data.
  } catch (error) {
    // error handling.
    console.log("ERR: ", JSON.stringify(error));
    return null;
  } finally {
    // finally.
  }
};

const downloadFileFromS3 = async (key) => {
  try {
    /*
        const command = new GetObjectCommand({
            Bucket: 'readdy-voice-content',
            Key: `${key}.mp3`
        });
        const data = await getSignedUrl(s3Client, command, { expiresIn: 86400 });
        console.log('Presigned URL: ', JSON.stringify(data));
        */
    console.log("Start file downloading...", JSON.stringify(key));
    const params = { Bucket: 'readdy-voice-content', Key: `${key}.mp3` };
    console.log('File params: ', JSON.stringify(params));
    const data = await s3.send(new GetObjectCommand(params));
    console.log('Before getting buffer...');
    //const contentBuffer = await getStream.buffer(data.Body);
    //console.log('Success, File content: ', contentBuffer);
    return data;
    // process data.
  } catch (error) {
    // error handling.
    console.log("ERR: ", JSON.stringify(error));
    return null;
  } finally {
    // finally.
  }
};

const bot = new Telegraf(token, {});

bot.start((ctx) => {
  ctx.reply(`Hello, I am Readdy and I can read web article for you. Just send me the link and I will reply you with mp3 file. Have a great listening!`);
});

bot.on("message", async (ctx) => {
  try {
    const url = ctx.update.message.text;
    const rv = await getReaderView(url);
    console.log("RV:", JSON.stringify(rv));
    const data = await startSpeechTask(rv.textContent);
    if (data === null) {
      ctx.reply(`Oops, issues....`);
      return;
    }
    const taskId = data.SynthesisTask.TaskId;
    const fileData = await downloadFileFromS3(taskId);
    if (fileData === null) {
      ctx.reply(`Oops, issues....`);
      return;
    }
    return await ctx.replyWithAudio({ source: fileData.Body, filename: `${rv.title}.mp3` });
  } catch (err) {
    console.log("ERR :", JSON.stringify(err));
    ctx.reply(`Oops, I'm crashed!`);
  }
});

exports.handler = async (event) => {
  console.log("REQ", JSON.stringify(event));
  const body = JSON.parse(event.body);
  await bot.handleUpdate(body);
  console.log("THEEND");
};
