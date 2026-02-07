#include <napi.h>
#include "moderation/TextFilter.hpp"

moderation::TextFilter* textFilter = nullptr;

Napi::Value ModerateText(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string text = info[0].As<Napi::String>().Utf8Value();

    if (!textFilter) {
        textFilter = new moderation::TextFilter();
    }

    bool hasBadWords = textFilter->containsBadWords(text);

    Napi::Object result = Napi::Object::New(env);
    result.Set("allowed", !hasBadWords);
    
    if (hasBadWords) {
        std::vector<std::string> badWords = textFilter->findBadWords(text);
        Napi::Array badWordsArray = Napi::Array::New(env, badWords.size());
        for (size_t i = 0; i < badWords.size(); i++) {
            badWordsArray[i] = Napi::String::New(env, badWords[i]);
        }
        result.Set("badWords", badWordsArray);
    }

    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "moderateText"), Napi::Function::New(env, ModerateText));
    return exports;
}

NODE_API_MODULE(moderation_engine, Init)
