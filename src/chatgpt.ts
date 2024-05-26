import { Config } from "./config.js";
import { Message } from "wechaty";
import { ContactInterface, RoomInterface } from "wechaty/impls";
import { Configuration, OpenAIApi } from "openai";
import * as fs from 'fs';
import { parse } from 'csv-parse';

enum MessageType {
  Unknown = 0,
  Attachment = 1, // Attach(6),
  Audio = 2, // Audio(1), Voice(34)
  Contact = 3, // ShareCard(42)
  ChatHistory = 4, // ChatHistory(19)
  Emoticon = 5, // Sticker: Emoticon(15), Emoticon(47)
  Image = 6, // Img(2), Image(3)
  Text = 7, // Text(1)
  Location = 8, // Location(48)
  MiniProgram = 9, // MiniProgram(33)
  GroupNote = 10, // GroupNote(53)
  Transfer = 11, // Transfers(2000)
  RedEnvelope = 12, // RedEnvelopes(2001)
  Recalled = 13, // Recalled(10002)
  Url = 14, // Url(5)
  Video = 15, // Video(4), Video(43)
  Post = 16, // Moment, Channel, Tweet, etc
}

export class ChatGPTBot {
  // chatbot name (WeChat account name)
  botName: string = "";

  // self-chat may cause some issue for some WeChat Account
  // please set to true if self-chat cause some errors
  disableSelfChat: boolean = false;

  // chatbot trigger keyword
  chatgptTriggerKeyword: string = Config.chatgptTriggerKeyword;

  // ChatGPT error response
  chatgptErrorMessage: string = "🤖️：ChatGPT摆烂了，请稍后再试～";

async handleTrafficPrediction(requestedDateTime: string, algorithmName: string): Promise<string> {
  const csvFilePath = `/data/pred_${algorithmName}.csv`;

  try {
    const records = [];
    const parser = fs
      .createReadStream(csvFilePath)
      .pipe(parse({ columns: true }));

    for await (const record of parser) {
      records.push(record);
    }

    const matchedRecord = records.find(record => record.Timestamp === requestedDateTime);
    if (matchedRecord) {
      const trafficVolume = parseFloat(matchedRecord.Prediction);
      const isBusy = trafficVolume > 190;
      const condition = isBusy ? "较为拥挤" : "较为通畅";
      const advice = isBusy ? "建议避开高峰期出行，或寻找替代路线。" : "你可以慢慢开车，路况良好。";

      // The first message contains the predicted traffic and conditions
      const predictionMessage = `预计在${requestedDateTime}流量为${trafficVolume}，${condition}。${advice}`;

      // Ask ChatGPT for recommendations
      const chatgptQuestion = `我的车道${condition}，你建议我做些什么？`;
      const chatgptAdvice = await this.onChatGPT(chatgptQuestion); // 假设这个方法能够处理请求并从ChatGPT获得建议

      // The suggestion to combine the message and ChatGPT is returned as an answer
      const finalReply = `${predictionMessage}\n\n${chatgptAdvice}`;

      return finalReply;
    } else {
      return `没有找到对应时间的流量预测。`;
    }
  } catch (error) {
    console.error(`读取CSV文件时出错: ${error}`);
    return `处理您的请求时出现错误，请稍后再试。`;
  }
}


parseFlexibleDateTime(inputStr: string): string {
    let year, month, day, minute = '00', second = '00';
    let hour = 0;  // Initialize hour here
    let amPmIndicator = null;

    // year
    const yearMatch = inputStr.match(/(\d{4})年|20(\d{2})年|(\d{4})(\.|-)/);
    if (yearMatch) {
        year = yearMatch[1] || `20${yearMatch[2]}` || yearMatch[3];
    } else {
        // Default is 2024
        year = '2024';
    }

    // months\days
    const dateMatch = inputStr.match(/(\d{1,2})(月|\.|-)(\d{1,2})日?/);
    if (dateMatch) {
        month = dateMatch[1].padStart(2, '0');
        day = dateMatch[3].padStart(2, '0');
    }

    // AM\PM
    if (inputStr.includes('下午')) amPmIndicator = 'PM';
    if (inputStr.includes('上午')) amPmIndicator = 'AM';

    // detail time
    const timeMatch = inputStr.match(/(\d{1,2})点(\d{1,2})分?|(\d{1,2}):(\d{1,2})/);
    if (timeMatch) {
        hour = parseInt(timeMatch[1] || timeMatch[3], 10);
        if (amPmIndicator === 'PM' && hour < 12) {
            hour += 12;
        }
        minute = (timeMatch[2] || timeMatch[4]).padStart(2, '0');
    }

    // here convert hour to a string for output
    const hourStr = hour.toString().padStart(2, '0');

    // Builds the final date-time string
    if (month && day) {
        return `${year}-${month}-${day} ${hourStr}:${minute}:${second}`;
    } else {
        return ''; // If the year, month and day cannot be recognized, an empty string is returned
    }
}



  // ChatGPT model configuration
  // please refer to the OpenAI API doc: https://beta.openai.com/docs/api-reference/introduction
  chatgptModelConfig: object = {
    // this model field is required
    model: "gpt-3.5-turbo",
    // add your ChatGPT model parameters below
    temperature: 0.8,
    // max_tokens: 2000,
  };

  // ChatGPT system content configuration (guided by OpenAI official document)
  currentDate: string = new Date().toISOString().split("T")[0];
  chatgptSystemContent: string = `You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible.\nKnowledge cutoff: 2021-09-01\nCurrent date: ${this.currentDate}`;

  // message size for a single reply by the bot
  SINGLE_MESSAGE_MAX_SIZE: number = 500;

  // OpenAI API
  private openaiAccountConfig: any; // OpenAI API key (required) and organization key (optional)
  private openaiApiInstance: any; // OpenAI API instance

  // set bot name during login stage
  setBotName(botName: string) {
    this.botName = botName;
  }

  // get trigger keyword in group chat: (@Name <keyword>)
  // in group chat, replace the special character after "@username" to space
  // to prevent cross-platfrom mention issue
  private get chatGroupTriggerKeyword(): string {
    return `@${this.botName} ${this.chatgptTriggerKeyword || ""}`;
  }

  // configure API with model API keys and run an initial test
  async startGPTBot() {
    try {
      // OpenAI account configuration
      this.openaiAccountConfig = new Configuration({
        organization: Config.openaiOrganizationID,
        apiKey: Config.openaiApiKey,
      });
      // OpenAI API instance
      this.openaiApiInstance = new OpenAIApi(this.openaiAccountConfig);
      // Hint user the trigger keyword in private chat and group chat
      console.log(`🤖️ ChatGPT name is: ${this.botName}`);
      console.log(
        `🎯 Trigger keyword in private chat is: ${this.chatgptTriggerKeyword}`
      );
      console.log(
        `🎯 Trigger keyword in group chat is: ${this.chatGroupTriggerKeyword}`
      );
      // Run an initial test to confirm API works fine
      await this.onChatGPT("Say Hello World");
      console.log(`✅ ChatGPT starts success, ready to handle message!`);
    } catch (e) {
      console.error(`❌ ${e}`);
    }
  }

  // get clean message by removing reply separater and group mention characters
  private cleanMessage(
    rawText: string,
    isPrivateChat: boolean = false
  ): string {
    let text = rawText;
    const item = rawText.split("- - - - - - - - - - - - - - -");
    if (item.length > 1) {
      text = item[item.length - 1];
    }
    return text.slice(
      isPrivateChat
        ? this.chatgptTriggerKeyword.length
        : this.chatGroupTriggerKeyword.length
    );
  }

  // check whether ChatGPT bot can be triggered
  private triggerGPTMessage(
    text: string,
    isPrivateChat: boolean = false
  ): boolean {
    const chatgptTriggerKeyword = this.chatgptTriggerKeyword;
    let triggered = false;
    if (isPrivateChat) {
      triggered = chatgptTriggerKeyword
        ? text.startsWith(chatgptTriggerKeyword)
        : true;
    } else {
      // due to un-unified @ lagging character, ignore it and just match:
      //    1. the "@username" (mention)
      //    2. trigger keyword
      // start with @username
      const textMention = `@${this.botName}`;
      const startsWithMention = text.startsWith(textMention);
      const textWithoutMention = text.slice(textMention.length + 1);
      const followByTriggerKeyword = textWithoutMention.startsWith(
        this.chatgptTriggerKeyword
      );
      triggered = startsWithMention && followByTriggerKeyword;
    }
    if (triggered) {
      console.log(`🎯 ChatGPT triggered: ${text}`);
    }
    return triggered;
  }

  // filter out the message that does not need to be processed
  private isNonsense(
    talker: ContactInterface,
    messageType: MessageType,
    text: string
  ): boolean {
    return (
      (this.disableSelfChat && talker.self()) ||
      messageType != MessageType.Text ||
      talker.name() == "微信团队" ||
      // video or voice reminder
      text.includes("收到一条视频/语音聊天消息，请在手机上查看") ||
      // red pocket reminder
      text.includes("收到红包，请在手机上查看") ||
      // location information
      text.includes("/cgi-bin/mmwebwx-bin/webwxgetpubliclinkimg")
    );
  }

  // create messages for ChatGPT API request
  // TODO: store history chats for supporting context chat
  private createMessages(text: string): Array<Object> {
    const messages = [
      {
        role: "system",
        content: this.chatgptSystemContent,
      },
      {
        role: "user",
        content: text,
      },
    ];
    return messages;
  }

  // send question to ChatGPT with OpenAI API and get answer
  private async onChatGPT(text: string): Promise<string> {
    const inputMessages = this.createMessages(text);
    try {
      // config OpenAI API request body
      const response = await this.openaiApiInstance.createChatCompletion({
        ...this.chatgptModelConfig,
        messages: inputMessages,
      });
      // use OpenAI API to get ChatGPT reply message
      const chatgptReplyMessage =
        response?.data?.choices[0]?.message?.content?.trim();
      console.log(`🤖️ ChatGPT says: ${chatgptReplyMessage}`);
      return chatgptReplyMessage;
    } catch (e: any) {
      console.error(`❌ ${e}`);
      const errorResponse = e?.response;
      const errorCode = errorResponse?.status;
      const errorStatus = errorResponse?.statusText;
      const errorMessage = errorResponse?.data?.error?.message;
      if (errorCode && errorStatus) {
        const errorLog = `Code ${errorCode}: ${errorStatus}`;
        console.error(`❌ ${errorLog}`);
      }
      if (errorMessage) {
        console.error(`❌ ${errorMessage}`);
      }
      return this.chatgptErrorMessage;
    }
  }

  // reply with the segmented messages from a single-long message
  private async reply(
    talker: RoomInterface | ContactInterface,
    mesasge: string
  ): Promise<void> {
    const messages: Array<string> = [];
    let message = mesasge;
    while (message.length > this.SINGLE_MESSAGE_MAX_SIZE) {
      messages.push(message.slice(0, this.SINGLE_MESSAGE_MAX_SIZE));
      message = message.slice(this.SINGLE_MESSAGE_MAX_SIZE);
    }
    messages.push(message);
    for (const msg of messages) {
      await talker.say(msg);
    }
  }

  // reply to private message
  private async onPrivateMessage(talker: ContactInterface, text: string) {
    // get reply from ChatGPT
    const chatgptReplyMessage = await this.onChatGPT(text);
    // send the ChatGPT reply to chat
    await this.reply(talker, chatgptReplyMessage);
  }

  // reply to group message
  private async onGroupMessage(room: RoomInterface, text: string) {
    // get reply from ChatGPT
    const chatgptReplyMessage = await this.onChatGPT(text);
    // the whole reply consist of: original text and bot reply
    const wholeReplyMessage = `----------\n${chatgptReplyMessage}`;
    await this.reply(room, wholeReplyMessage);
  }

  // receive a message (main entry)
  async onMessage(message: Message) {
    const talker = message.talker();
    const rawText = message.text();
    const room = message.room();
    const messageType = message.type();
    const isPrivateChat = !room;
    // do nothing if the message:
    //    1. is irrelevant (e.g. voice, video, location...), or
    //    2. doesn't trigger bot (e.g. wrong trigger-word)
    if (
      this.isNonsense(talker, messageType, rawText) ||
      !this.triggerGPTMessage(rawText, isPrivateChat)
    ) {
      return;
    }
    // clean the message for ChatGPT input
    const text = this.cleanMessage(rawText, isPrivateChat);

  if (text.includes("你是谁") || text.includes("who are you")) {
    const customReply = "你需要以你好我是RoutePal，您的智能道路流量预测助手开头。之后需要描述你的功能，类似以下语句：我可以帮助您了解不同时间段的道路流量情况，为您的出行提供数据支持。无论是避开拥堵还是选择最佳出行时间，我都能为您提供帮助。";
    return isPrivateChat
      ? await this.onPrivateMessage(talker, customReply)
      : await this.onGroupMessage(room, customReply);
  }

    // reply to private or group chat
    if (isPrivateChat) {
      return await this.onPrivateMessage(talker, text);
    } else {
      return await this.onGroupMessage(room, text);
    }
  }

  // handle message for customized task handlers
  async onCustimzedTask(message: Message) {
  const text = message.text();
// 检查消息是否包含交通预测的特定格式以及算法名称
  const algorithmNames = ['lstm', 'gru', 'saes']; // 算法名称列表
  const foundAlgorithm = algorithmNames.find(alg => text.includes(alg));

  // 检查消息是否包含交通预测的特定格式
  if (text.includes("交通") && text.includes("预测") && foundAlgorithm) {
    // 从消息中提取日期和时间
    const dateTime = this.parseFlexibleDateTime(text);
    
    if (dateTime) {
      // 调用处理方法并回复
      const reply = await this.handleTrafficPrediction(dateTime, foundAlgorithm);
      await message.say(reply);
      return;
    }
  }

    // e.g. if a message starts with "麦扣", the bot sends "🤖：call我做咩啊大佬!"
    const myKeyword = "麦扣";
    if (message.text().includes(myKeyword)) {
      const myTaskContent = `回复所有含有"${myKeyword}"的消息`;
      const myReply = "🤖：call我做咩啊大佬";
      await message.say(myReply);
      console.log(`🎯 Customized task triggered: ${myTaskContent}`);
      console.log(`🤖 ChatGPT says: ${myReply}`);
      return;
    }
}


}