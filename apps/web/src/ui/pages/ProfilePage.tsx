import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  apiGetProfile,
  apiUpdateProfile,
  apiChangePasswordProfile,
  apiUploadProfilePhoto,
  apiDeleteProfilePhoto,
  type UserProfile,
} from "../../api/client";
import styles from "./ProfilePage.module.css";

export function ProfilePage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const authUser = state.user;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  // Edit mode states
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editData, setEditData] = useState<Partial<UserProfile>>({});
  
  // Password change states
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  // Photo upload states
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (token) {
      loadProfile();
    }
  }, [token]);

  async function loadProfile() {
    try {
      setLoading(true);
      setError("");
      const data = await apiGetProfile(token!);
      setProfile(data.profile);
      setEditData({
        full_name: data.profile.full_name || "",
        first_name: data.profile.first_name || "",
        last_name: data.profile.last_name || "",
        middle_name: data.profile.middle_name || "",
        phone: data.profile.phone || "",
        birth_date: data.profile.birth_date || "",
      });
    } catch (err: any) {
      setError(err.message || "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveInfo() {
    try {
      setError("");
      setSuccess("");
      const data = await apiUpdateProfile(token!, editData);
      setProfile(data.profile);
      setIsEditingInfo(false);
      setSuccess("Profile updated successfully");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to update profile");
    }
  }

  async function handleChangePassword() {
    try {
      setError("");
      setSuccess("");

      if (!currentPassword || !newPassword || !confirmPassword) {
        setError("All password fields are required");
        return;
      }

      if (newPassword !== confirmPassword) {
        setError("New passwords do not match");
        return;
      }

      if (newPassword.length < 6) {
        setError("New password must be at least 6 characters");
        return;
      }

      const data = await apiChangePasswordProfile(token!, currentPassword, newPassword);
      setSuccess(data.message);
      setIsChangingPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to change password");
    }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file type
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }

    // Check file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError("Image size must be less than 5MB");
      return;
    }

    try {
      setError("");
      setIsUploading(true);
      setUploadProgress(0);

      const data = await apiUploadProfilePhoto(token!, file, (percent) => {
        setUploadProgress(percent);
      });

      setProfile((prev) => (prev ? { ...prev, photo_data_url: data.photo_url } : prev));
      setSuccess("Photo uploaded successfully");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to upload photo");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleDeletePhoto() {
    if (!confirm("Are you sure you want to delete your profile photo?")) return;

    try {
      setError("");
      await apiDeleteProfilePhoto(token!);
      setProfile((prev) => (prev ? { ...prev, photo_data_url: null } : prev));
      setSuccess("Photo deleted successfully");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to delete photo");
    }
  }

  if (loading) {
    return (
      <div className={styles.profilePage}>
        <p>Loading profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={styles.profilePage}>
        <div className={styles.error}>Profile not found</div>
      </div>
    );
  }

  const isStudent = authUser?.role === "student";
  const canUploadPhoto = !isStudent;
  const initials = profile.full_name
    ? profile.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : profile.username[0].toUpperCase();

  return (
    <div className={styles.profilePage}>
      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      {/* Header with Avatar */}
      <div className={styles.header}>
        <div className={styles.avatarSection}>
          {profile.photo_data_url ? (
            <img src={profile.photo_data_url} alt="Profile" className={styles.avatar} />
          ) : (
            <div className={styles.avatarPlaceholder}>{initials}</div>
          )}

          {canUploadPhoto && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                style={{ display: "none" }}
              />
              <button
                className={styles.uploadButton}
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                title="Upload photo"
              >
                📷
              </button>
            </>
          )}

          {isUploading && (
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
        </div>

        <div className={styles.headerInfo}>
          <h1>{profile.full_name || profile.username}</h1>
          <span className={`${styles.role} ${styles[profile.role]}`}>
            {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
          </span>
          {profile.teacher_subject_name && (
            <p style={{ marginTop: "0.5rem", color: "#6b7280" }}>
              Subject: {profile.teacher_subject_name}
            </p>
          )}
        </div>
      </div>

      {/* Personal Information */}
      <div className={styles.section}>
        <h2>Personal Information</h2>

        {!isEditingInfo ? (
          <div>
            <p>
              <strong>Full Name:</strong> {profile.full_name || "—"}
            </p>
            <p>
              <strong>First Name:</strong> {profile.first_name || "—"}
            </p>
            <p>
              <strong>Last Name:</strong> {profile.last_name || "—"}
            </p>
            <p>
              <strong>Middle Name:</strong> {profile.middle_name || "—"}
            </p>
            <p>
              <strong>Phone:</strong> {profile.phone || "—"}
            </p>
            <p>
              <strong>Birth Date:</strong> {profile.birth_date || "—"}
            </p>
            <p>
              <strong>Username:</strong> {profile.username}
            </p>

            <div className={styles.formActions}>
              <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => setIsEditingInfo(true)}>
                Edit Information
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.form}>
            <div className={styles.formGroup}>
              <label>Full Name</label>
              <input
                type="text"
                value={editData.full_name || ""}
                onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
              />
            </div>

            <div className={styles.formGroup}>
              <label>First Name</label>
              <input
                type="text"
                value={editData.first_name || ""}
                onChange={(e) => setEditData({ ...editData, first_name: e.target.value })}
              />
            </div>

            <div className={styles.formGroup}>
              <label>Last Name</label>
              <input
                type="text"
                value={editData.last_name || ""}
                onChange={(e) => setEditData({ ...editData, last_name: e.target.value })}
              />
            </div>

            <div className={styles.formGroup}>
              <label>Middle Name</label>
              <input
                type="text"
                value={editData.middle_name || ""}
                onChange={(e) => setEditData({ ...editData, middle_name: e.target.value })}
              />
            </div>

            <div className={styles.formGroup}>
              <label>Phone</label>
              <input
                type="tel"
                value={editData.phone || ""}
                onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                disabled={isStudent}
              />
              {isStudent && <p className={styles.infoText}>Students cannot change phone number</p>}
            </div>

            <div className={styles.formGroup}>
              <label>Birth Date</label>
              <input
                type="date"
                value={editData.birth_date || ""}
                onChange={(e) => setEditData({ ...editData, birth_date: e.target.value })}
              />
            </div>

            <div className={styles.formActions}>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => setIsEditingInfo(false)}
              >
                Cancel
              </button>
              <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={handleSaveInfo}>
                Save Changes
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Change Password */}
      <div className={styles.section}>
        <h2>Change Password</h2>

        {!isChangingPassword ? (
          <div className={styles.formActions}>
            <button
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => setIsChangingPassword(true)}
            >
              Change Password
            </button>
          </div>
        ) : (
          <div className={styles.form}>
            <div className={styles.formGroup}>
              <label>Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label>New Password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <p className={styles.infoText}>Minimum 6 characters</p>
            </div>

            <div className={styles.formGroup}>
              <label>Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <div className={styles.formActions}>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => {
                  setIsChangingPassword(false);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
              >
                Cancel
              </button>
              <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={handleChangePassword}>
                Update Password
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Photo (if exists and can upload) */}
      {canUploadPhoto && profile.photo_data_url && (
        <div className={styles.section}>
          <h2>Danger Zone</h2>
          <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
            Delete your profile photo. This action cannot be undone.
          </p>
          <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={handleDeletePhoto}>
            Delete Profile Photo
          </button>
        </div>
      )}
    </div>
  );
}
