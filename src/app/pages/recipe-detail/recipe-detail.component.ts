import { Component, inject, OnInit, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RecipeService, StorageService } from '../../services';
import { Recipe } from '../../models';
import { ImagePlaceholderComponent } from '../../components/ui/image-placeholder/image-placeholder.component';

@Component({
  selector: 'app-recipe-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, ImagePlaceholderComponent],
  templateUrl: './recipe-detail.component.html',
  styleUrls: ['./recipe-detail.component.scss']
})
export class RecipeDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private recipeService = inject(RecipeService);
  private storageService = inject(StorageService);

  recipe: Recipe | undefined;
  isFavorite = false;
  userRating = 0;
  servings = 4;
  notes = '';
  showNotes = false;
  imageError = false;

  scaledRecipe = computed(() => {
    if (!this.recipe) return undefined;
    return this.recipeService.scaleRecipe(this.recipe, this.servings);
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.recipe = this.recipeService.getRecipeById(id);
      if (this.recipe) {
        this.isFavorite = this.recipeService.isFavorite(id);
        this.userRating = this.recipeService.getUserRating(id) || 0;
        this.servings = this.recipe.servings;
        this.imageError = false; // Reset error state
        this.loadNotes();
      } else {
        this.router.navigate(['/recipes']);
      }
    }
  }

  handleImageError(): void {
    this.imageError = true;
  }

  loadNotes(): void {
    if (this.recipe) {
      this.storageService.getRecipeNotes(this.recipe.id).subscribe(notes => {
        this.notes = notes || '';
      });
    }
  }

  toggleFavorite(): void {
    if (this.recipe) {
      this.recipeService.toggleFavorite(this.recipe.id);
      this.isFavorite = !this.isFavorite;
    }
  }

  setRating(rating: number): void {
    if (this.recipe) {
      this.recipeService.setRating(this.recipe.id, rating);
      this.userRating = rating;
    }
  }

  updateServings(change: number): void {
    const newServings = this.servings + change;
    if (newServings >= 1 && newServings <= 20) {
      this.servings = newServings;
    }
  }

  toggleIngredientChecked(ingredientId: string): void {
    // This would be implemented with a service to track checked ingredients
    console.log('Toggle ingredient:', ingredientId);
  }

  startCookingMode(): void {
    if (this.recipe) {
      this.router.navigate(['/cooking', this.recipe.id]);
    }
  }

  addToMealPlan(): void {
    if (this.recipe) {
      this.router.navigate(['/meal-plan'], { queryParams: { addRecipe: this.recipe.id } });
    }
  }

  addToShoppingList(): void {
    if (this.recipe) {
      this.router.navigate(['/shopping-list'], { queryParams: { addRecipe: this.recipe.id } });
    }
  }

  toggleNotes(): void {
    this.showNotes = !this.showNotes;
  }

  saveNotes(): void {
    if (this.recipe) {
      this.storageService.setRecipeNotes(this.recipe.id, this.notes).subscribe();
    }
  }

  shareRecipe(): void {
    if (this.recipe) {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
        alert('Recipe link copied to clipboard!');
      });
    }
  }

  printRecipe(): void {
    window.print();
  }

  goBack(): void {
    this.router.navigate(['/recipes']);
  }

  formatTime(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}
