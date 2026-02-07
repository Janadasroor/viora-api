#include "TextFilter.hpp"
#include <algorithm>
#include <sstream>
#include <iostream>

namespace moderation {

TextFilter::TextFilter() {
    loadBadWords();
}

TextFilter::~TextFilter() {}

void TextFilter::loadBadWords() {
    // TODO: Load from file or database
    // For now, hardcode some bad words for demonstration
    badWords = {
        "badword",
        "spam",
        "offensive",
        "hate",
        "asshole"
    };
}

bool TextFilter::containsBadWords(const std::string& text) {
    std::string lowerText = text;
    std::transform(lowerText.begin(), lowerText.end(), lowerText.begin(), ::tolower);

    std::stringstream ss(lowerText);
    std::string word;
    while (ss >> word) {
        // Simple exact match for now. 
        // In production, we'd want more sophisticated matching (e.g. Aho-Corasick, regex, etc.)
        if (badWords.find(word) != badWords.end()) {
            return true;
        }
    }
    return false;
}

std::vector<std::string> TextFilter::findBadWords(const std::string& text) {
    std::vector<std::string> found;
    std::string lowerText = text;
    std::transform(lowerText.begin(), lowerText.end(), lowerText.begin(), ::tolower);

    std::stringstream ss(lowerText);
    std::string word;
    while (ss >> word) {
        if (badWords.find(word) != badWords.end()) {
            found.push_back(word);
        }
    }
    return found;
}

} // namespace moderation
