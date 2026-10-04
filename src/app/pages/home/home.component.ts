import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { RecipeService } from '../../services';
import { RecipeCardComponent } from '../../components';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, RecipeCardComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {
  private router = inject(Router);
  private recipeService = inject(RecipeService);

  filteredRecipes = this.recipeService.filteredRecipes;
  favorites = this.recipeService.favorites;
  quickRecipes = this.recipeService.getQuickRecipes();
  easyRecipes = this.recipeService.getEasyRecipes();

  officialPicks = computed(() => this.recipeService.recipes().filter(r => r.isOfficial).slice(0, 4));

  communityPicks = computed(() =>
    [...this.recipeService.recipes()]
      .filter(r => !r.isOfficial)
      .sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime())
      .slice(0, 4)
  );

  mostTwisted = computed(() =>
    [...this.recipeService.recipes()]
      .filter(r => r.twistCount > 0)
      .sort((a, b) => b.twistCount - a.twistCount)
      .slice(0, 4)
  );

  recentlyViewed = this.recipeService.recentlyViewedRecipes;

  onFavoriteToggled(recipeId: string): void {
    this.recipeService.toggleFavorite(recipeId);
  }

  onAddToMealPlan(recipeId: string): void {
    this.router.navigate(['/meal-plan'], { queryParams: { addRecipe: recipeId } });
  }

  navigateToRecipes(): void {
    this.router.navigate(['/recipes']);
  }
}
