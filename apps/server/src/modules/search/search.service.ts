import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SearchHistory } from "./entity/search-history.entity";

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(SearchHistory)
    private searchHistoryRepository: Repository<SearchHistory>,
  ) {}

  async addSearchHistory(userId: string, keyword: string): Promise<SearchHistory> {
    const existing = await this.searchHistoryRepository.findOne({
      where: { userId, keyword },
    });

    if (existing) {
      existing.count += 1;
      existing.updatedAt = new Date();
      return this.searchHistoryRepository.save(existing);
    }

    const history = this.searchHistoryRepository.create({
      userId,
      keyword,
      count: 1,
    });

    return this.searchHistoryRepository.save(history);
  }

  async getSearchHistory(userId: string, limit: number = 10): Promise<SearchHistory[]> {
    return this.searchHistoryRepository.find({
      where: { userId },
      order: { updatedAt: "DESC" },
      take: limit,
    });
  }

  async deleteSearchHistory(userId: string, keyword: string): Promise<void> {
    await this.searchHistoryRepository.delete({ userId, keyword });
  }

  async clearSearchHistory(userId: string): Promise<void> {
    await this.searchHistoryRepository.delete({ userId });
  }
}