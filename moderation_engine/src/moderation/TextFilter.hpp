#pragma once

#include <string>
#include <vector>
#include <unordered_set>

namespace moderation {

class TextFilter {
public:
    TextFilter();
    ~TextFilter();

    bool containsBadWords(const std::string& text);
    std::vector<std::string> findBadWords(const std::string& text);

private:
    std::unordered_set<std::string> badWords;
    void loadBadWords();
};

} // namespace moderation
