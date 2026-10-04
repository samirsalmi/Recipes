import { Component, inject, OnInit, computed, effect, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService, RecipeService, StorageService, ToastService } from '../../services';
import { isAuthenticated } from '../../services/auth-state';
import { Recipe } from '../../models';
import { optimizeImage } from '../../utils/image-url';
import { ImagePlaceholderComponent } from '../../components/ui/image-placeholder/image-placeholder.component';

@Component({
  selector: 'app-recipe-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ImagePlaceholderComponent],
  templateUrl: './recipe-detail.component.html',
  styleUrls: ['./recipe-detail.component.scss']
})
export class RecipeDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private recipeService = inject(RecipeService);
  private storageService = inject(StorageService);
  private authService = inject(AuthService);
  private toastService = inject(ToastService);

  recipe: Recipe | undefined;
  parentRecipe: Recipe | undefined;
  twists = signal<Recipe[]>([]);
  isFavorite = false;
  userRating = 0;
  // A signal, not a plain field: scaledRecipe below needs a tracked dependency to know when
  // to recompute - a plain field never triggers computed() to re-run (see gotcha G16).
  servings = signal(4);
  notes = '';
  showNotes = false;
  imageError = false;
  isTwisting = signal(false);

  private recipeId: string | null = null;
  private resolveAttempted = false;

  scaledRecipe = computed(() => {
    if (!this.recipe) return undefined;
    return this.recipeService.scaleRecipe(this.recipe, this.servings());
  });

  currentUser = this.authService.currentUser;
  isAdmin = this.authService.isAdmin;

  // Plain methods, not computed(): `recipe` is a regular field (reassigned outside any
  // signal write), so a computed() here would cache its pre-load value forever, same class
  // of staleness bug as gotcha G1. Angular re-evaluates a template method call every check.
  isOwner(): boolean {
    const user = this.currentUser();
    return !!user && !!this.recipe && this.recipe.ownerId === user.id;
  }

  canTwist(): boolean {
    return isAuthenticated() && !!this.recipe && !this.isOwner() && !this.recipe.parentRecipeId;
  }

  constructor() {
    // The recipe catalog loads asynchronously from the backend, so resolve the
    // route's recipe once it arrives instead of only looking it up in ngOnInit.
    effect(() => {
      if (this.recipe || !this.recipeId) return;
      const found = this.recipeService.recipes().find(r => r.id === this.recipeId);
      if (found) {
        this.setRecipe(found);
      } else if (this.recipeService.recipesLoaded() && !this.resolveAttempted) {
        // Not in the discovery-backed catalog - it may be a private/unlisted recipe or a
        // twist you own, so fall back to a direct-by-id fetch before redirecting away.
        this.resolveAttempted = true;
        this.recipeService.resolveRecipe(this.recipeId).subscribe(recipe => {
          if (recipe) {
            this.setRecipe(recipe);
          } else {
            this.router.navigate(['/recipes']);
          }
        });
      }
    });
  }

  private setRecipe(recipe: Recipe): void {
    this.recipe = recipe;
    this.isFavorite = this.recipeService.isFavorite(recipe.id);
    this.userRating = this.recipeService.getUserRating(recipe.id) || 0;
    this.servings.set(recipe.servings);
    this.imageError = false;
    this.loadNotes();
    this.loadTwists();
    this.recipeService.recordView(recipe.id);
    if (recipe.parentRecipeId) {
      this.recipeService.resolveRecipe(recipe.parentRecipeId).subscribe(parent => {
        this.parentRecipe = parent ?? undefined;
      });
    }
  }

  private loadTwists(): void {
    if (!this.recipe) return;
    this.recipeService.getTwists(this.recipe.id).subscribe(twists => this.twists.set(twists));
  }

  ngOnInit(): void {
    this.recipeId = this.route.snapshot.paramMap.get('id');
    if (!this.recipeId) {
      this.router.navigate(['/recipes']);
    }
  }

  optimizedImage(url: string): string {
    return optimizeImage(url, 1200);
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
    const newServings = this.servings() + change;
    if (newServings >= 1 && newServings <= 20) {
      this.servings.set(newServings);
    }
  }

  toggleIngredientChecked(ingredientId: string): void {
    // This would be implemented with a service to track checked ingredients
    console.log('Toggle ingredient:', ingredientId);
  }

  startCookingMode(): void {
    if (this.recipe && this.recipe.steps.length > 0) {
      this.router.navigate(['/cooking', this.recipe.id]);
    }
  }

  toggleVisibility(): void {
    if (!this.recipe || !this.isOwner()) return;
    const newIsPublic = !this.recipe.isPublic;
    this.recipeService.updateRecipe(this.recipe.id, { isPublic: newIsPublic }).subscribe(updated => {
      this.recipe = updated;
    });
  }

  toggleOfficial(): void {
    if (!this.recipe || !this.isAdmin()) return;
    this.recipeService.setOfficial(this.recipe.id, !this.recipe.isOfficial).subscribe(updated => {
      this.recipe = updated;
    });
  }

  deleteRecipe(): void {
    if (!this.recipe || !this.isOwner()) return;
    if (!confirm(`Delete "${this.recipe.name}"? This can't be undone.`)) return;
    this.recipeService.deleteRecipe(this.recipe.id).subscribe(() => {
      this.toastService.show('Recipe deleted.');
      this.router.navigate(['/my-recipes']);
    });
  }

  addToMyBook(): void {
    if (!this.recipe || !this.canTwist() || this.isTwisting()) return;
    this.isTwisting.set(true);
    this.recipeService.twistRecipe(this.recipe.id).subscribe({
      next: twist => this.router.navigate(['/recipes', twist.id]),
      error: () => this.isTwisting.set(false)
    });
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
    if (!isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }
    if (this.recipe) {
      this.storageService.setRecipeNotes(this.recipe.id, this.notes).subscribe();
    }
  }

  shareRecipe(): void {
    if (this.recipe) {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
        this.toastService.show('Recipe link copied to clipboard!');
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
