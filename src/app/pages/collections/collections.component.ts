import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollectionService, RecipeService } from '../../services';
import { RecipeCardComponent } from '../../components';

@Component({
  selector: 'app-collections',
  standalone: true,
  imports: [CommonModule, RouterLink, RecipeCardComponent, FormsModule],
  templateUrl: './collections.component.html',
  styleUrls: ['./collections.component.scss']
})
export class CollectionsComponent {
  private router = inject(Router);
  private collectionService = inject(CollectionService);
  private recipeService = inject(RecipeService);

  collections = this.collectionService.collections;
  favorites = this.recipeService.favorites;

  showCreateModal = false;
  newCollectionName = '';
  newCollectionDescription = '';

  onCreateCollection(): void {
    if (this.newCollectionName.trim()) {
      this.collectionService.createCollection(
        this.newCollectionName.trim(),
        this.newCollectionDescription.trim() || undefined
      );
      this.newCollectionName = '';
      this.newCollectionDescription = '';
      this.showCreateModal = false;
    }
  }

  deleteCollection(id: string): void {
    if (confirm('Are you sure you want to delete this collection?')) {
      this.collectionService.deleteCollection(id);
    }
  }

  getRecipesInCollection(collectionId: string) {
    return this.collectionService.getRecipesInCollection(collectionId);
  }

  onFavoriteToggled(recipeId: string): void {
    this.recipeService.toggleFavorite(recipeId);
  }

  onAddToMealPlan(recipeId: string): void {
    this.router.navigate(['/meal-plan'], { queryParams: { addRecipe: recipeId } });
  }
}
